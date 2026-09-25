import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { desktopCapturer, screen, type NativeImage } from "electron";
import type { RecordingAssetLocation } from "@path/database";
import { mapClickCoordinates, type SessionClock } from "@path/recording-core";
import type { CaptureSource, ClickEvent, StartRecordingInput } from "@path/shared";
import type { GlobalInputCapture, GlobalMouseDownEvent } from "../input/GlobalInputCapture";
import type { RemoteRepositories } from "../storage/DatabaseClient";
import type { Diagnostics } from "../storage/DiagnosticLog";
import type { ManagedRecordingAssets } from "../storage/ManagedRecordingAssets";
import { addClickMarker } from "./ClickScreenshotMarker";

interface ClickCaptureSession {
  location: RecordingAssetLocation;
  clock: SessionClock;
  input: StartRecordingInput;
  source: CaptureSource;
}

/** Operational limits for click capture; see `ClickCaptureCoordinator`. */
export const CLICK_CAPTURE_LIMITS = {
  // Native screenshots are slow; beyond this backlog a click is stored without one.
  maxPendingScreenshots: 8,
  // Clicks written together in one transaction.
  writeBatchSize: 50,
  // Delays before retrying a failed database write; the last failure keeps clicks queued.
  writeRetryDelaysMs: [250, 1_000, 4_000],
} as const;

export type ClickCaptureLimits = typeof CLICK_CAPTURE_LIMITS;

/** Clicks still unsaved after every retry; reported to the user when capture stops. */
export interface ClickFlushResult {
  unsavedClickCount: number;
}

/**
 * Turns native input into ordered click evidence tied to one recording clock. Screenshots are
 * captured one at a time with a bounded backlog: under backpressure the click is kept without a
 * screenshot rather than dropped. Clicks are written in order, in transactional batches, with
 * bounded retries; clicks that still fail stay queued and are reported, never silently lost.
 */
export class ClickCaptureCoordinator {
  private session: ClickCaptureSession | null = null;
  private paused = false;
  private screenshotQueue = Promise.resolve();
  private pendingScreenshotCount = 0;
  private unsavedClicks: ClickEvent[] = [];
  private writing: Promise<void> = Promise.resolve();
  private isWriteScheduled = false;

  constructor(
    private readonly recordings: Pick<RemoteRepositories["recordings"], "insertClicks">,
    private readonly assets: Pick<ManagedRecordingAssets, "clickScreenshotPath" | "remove">,
    private readonly inputCapture: GlobalInputCapture,
    private readonly diagnostics: Diagnostics,
    private readonly limits: ClickCaptureLimits = CLICK_CAPTURE_LIMITS,
    private readonly wait: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  async start(session: ClickCaptureSession): Promise<void> {
    this.session = session;
    this.paused = false;
    await this.inputCapture.start((event) => this.record(event));
  }

  async stop(): Promise<void> {
    await this.inputCapture.stop();
    this.session = null;
    this.paused = false;
  }

  async pause(): Promise<void> {
    if (!this.session || this.paused) return;

    this.paused = true;
    await this.inputCapture.stop();
  }

  async resume(): Promise<void> {
    if (!this.session || !this.paused) return;

    this.paused = false;
    await this.inputCapture.start((event) => this.record(event));
  }

  /**
   * Waits for queued screenshots and writes. Clicks that cannot be stored after every retry are
   * reported; their screenshots are removed so no file is left without a row.
   */
  async flush(): Promise<ClickFlushResult> {
    await this.screenshotQueue;
    this.scheduleWrite();
    await this.writing;

    const unsaved = this.unsavedClicks;

    this.unsavedClicks = [];

    for (const click of unsaved) {
      if (click.screenshotPath) {
        await this.assets.remove(click.screenshotPath, false).catch((error: unknown) => {
          this.diagnostics.warn("Unable to remove the screenshot of an unsaved click", error);
        });
      }
    }

    if (unsaved.length > 0) {
      this.diagnostics.error(`${unsaved.length} captured clicks could not be saved`);
    }

    return { unsavedClickCount: unsaved.length };
  }

  private record(event: GlobalMouseDownEvent): void {
    const session = this.session;

    if (!session || this.paused) return;

    const click = this.createClick(session, event);

    if (!click.insideCaptureRegion && session.input.captureMode !== "window") {
      return;
    }

    if (this.pendingScreenshotCount >= this.limits.maxPendingScreenshots) {
      this.diagnostics.warn("Click screenshot skipped because earlier screenshots are pending");
      this.enqueueWrite(click);

      return;
    }

    this.pendingScreenshotCount += 1;

    // Capture the event's session now; queued screenshots may finish after input capture stops.
    this.screenshotQueue = this.screenshotQueue.then(async () => {
      let screenshotPath: string | null = null;

      try {
        screenshotPath = await this.saveScreenshot(session, click);
      } catch (error) {
        // The click itself is still evidence; keep it without an image.
        this.diagnostics.warn("Click screenshot failed; the click is kept without one", error);
      } finally {
        this.pendingScreenshotCount -= 1;
      }

      this.enqueueWrite({ ...click, screenshotPath });
    });
  }

  private async saveScreenshot(session: ClickCaptureSession, click: ClickEvent): Promise<string> {
    const screenshot = await this.captureScreenshot(session);

    if (!screenshot) throw new Error("The capture source did not provide a screenshot");

    if (click.normalizedX === null || click.normalizedY === null) {
      throw new Error("Unable to map the click onto its screenshot");
    }

    const screenshotPath = await this.assets.clickScreenshotPath(session.location, click.id);

    await writeFile(
      screenshotPath,
      addClickMarker(screenshot.toPNG(), click.normalizedX, click.normalizedY),
    );

    return screenshotPath;
  }

  private enqueueWrite(click: ClickEvent): void {
    this.unsavedClicks.push(click);
    this.scheduleWrite();
  }

  private scheduleWrite(): void {
    if (this.isWriteScheduled) return;

    this.isWriteScheduled = true;
    this.writing = this.writing.then(async () => {
      this.isWriteScheduled = false;
      await this.writeUnsavedClicks();
    });
  }

  /** Writes queued clicks in order; a batch that keeps failing stays at the front of the queue. */
  private async writeUnsavedClicks(): Promise<void> {
    while (this.unsavedClicks.length > 0) {
      const batch = this.unsavedClicks.slice(0, this.limits.writeBatchSize);

      if (!(await this.insertWithRetries(batch))) return;

      this.unsavedClicks.splice(0, batch.length);
    }
  }

  private async insertWithRetries(batch: ClickEvent[]): Promise<boolean> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.recordings.insertClicks(batch);

        return true;
      } catch (error) {
        const delayMs = this.limits.writeRetryDelaysMs[attempt];

        if (delayMs === undefined) {
          this.diagnostics.error("Captured clicks could not be saved; they remain queued", error);

          return false;
        }

        this.diagnostics.warn("Saving captured clicks failed; retrying", error);
        await this.wait(delayMs);
      }
    }
  }

  private createClick(session: ClickCaptureSession, event: GlobalMouseDownEvent): ClickEvent {
    // Native Windows input is in physical pixels; Electron display geometry is in DIP.
    const dipPoint =
      process.platform === "win32"
        ? screen.screenToDipPoint({ x: event.x, y: event.y })
        : { x: event.x, y: event.y };

    const display = screen.getDisplayNearestPoint(dipPoint);
    const captureRegion = session.input.captureRegion ?? session.source.displayBounds;
    const scaleFactor =
      session.input.captureRegion?.scaleFactor ?? session.source.scaleFactor ?? display.scaleFactor;

    const mapped = captureRegion
      ? mapClickCoordinates({
          globalPoint: dipPoint,
          display: {
            id: display.id.toString(),
            globalBounds: display.bounds,
            electronBounds: display.bounds,
            scaleFactor: display.scaleFactor,
          },
          captureRegion,
          videoFrame: {
            width: Math.max(1, Math.round(captureRegion.width * scaleFactor)),
            height: Math.max(1, Math.round(captureRegion.height * scaleFactor)),
          },
        })
      : null;

    const createdAt = new Date().toISOString();

    return {
      id: randomUUID(),
      recordingId: session.location.recordingId,
      timestampMs: Math.round(session.clock.elapsedMs()),
      button: event.button,
      globalX: event.x,
      globalY: event.y,
      displayId: display.id.toString(),
      displayX: mapped?.displayX ?? dipPoint.x - display.bounds.x,
      displayY: mapped?.displayY ?? dipPoint.y - display.bounds.y,
      captureX: mapped?.captureX ?? null,
      captureY: mapped?.captureY ?? null,
      videoX: mapped?.videoX ?? null,
      videoY: mapped?.videoY ?? null,
      normalizedX: mapped?.normalizedX ?? null,
      normalizedY: mapped?.normalizedY ?? null,
      recordingFrameWidth: captureRegion
        ? Math.max(1, Math.round(captureRegion.width * scaleFactor))
        : null,
      recordingFrameHeight: captureRegion
        ? Math.max(1, Math.round(captureRegion.height * scaleFactor))
        : null,
      insideCaptureRegion: mapped?.insideCaptureRegion ?? session.input.captureMode === "window",
      screenshotPath: null,
      actionDescription: null,
      createdAt,
    };
  }

  private async captureScreenshot(session: ClickCaptureSession): Promise<NativeImage | null> {
    const captureRegion = session.input.captureRegion ?? session.source.displayBounds;
    const scaleFactor = session.input.captureRegion?.scaleFactor ?? session.source.scaleFactor ?? 1;
    const thumbnailSize = captureRegion
      ? {
          width: Math.max(1, Math.round(captureRegion.width * scaleFactor)),
          height: Math.max(1, Math.round(captureRegion.height * scaleFactor)),
        }
      : { width: 1920, height: 1080 };

    const sources = await desktopCapturer.getSources({
      types: [session.source.type],
      thumbnailSize,
      fetchWindowIcons: false,
    });

    const source = sources.find((candidate) => candidate.id === session.input.sourceId);

    if (!source || source.thumbnail.isEmpty()) return null;

    if (!session.input.captureRegion || !session.source.displayBounds) {
      return source.thumbnail;
    }

    const size = source.thumbnail.getSize();
    const displayBounds = session.source.displayBounds;

    // Map the selected desktop region onto the actual thumbnail dimensions before cropping.
    return source.thumbnail.crop({
      x: Math.max(
        0,
        Math.round(
          ((session.input.captureRegion.x - displayBounds.x) / displayBounds.width) * size.width,
        ),
      ),
      y: Math.max(
        0,
        Math.round(
          ((session.input.captureRegion.y - displayBounds.y) / displayBounds.height) * size.height,
        ),
      ),
      width: Math.min(
        size.width,
        Math.max(
          1,
          Math.round((session.input.captureRegion.width / displayBounds.width) * size.width),
        ),
      ),
      height: Math.min(
        size.height,
        Math.max(
          1,
          Math.round((session.input.captureRegion.height / displayBounds.height) * size.height),
        ),
      ),
    });
  }
}
