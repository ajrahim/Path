import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { desktopCapturer, screen, type NativeImage } from "electron";
import type { RecordingRepository } from "@path/database";
import { mapClickCoordinates, type SessionClock } from "@path/recording-core";
import type { CaptureSource, ClickEvent, StartRecordingInput } from "@path/shared";
import type { GlobalInputCapture, GlobalMouseDownEvent } from "../input/GlobalInputCapture";
import type { ManagedRecordingAssets } from "../storage/ManagedRecordingAssets";
import { addClickMarker } from "./ClickScreenshotMarker";

interface ClickCaptureSession {
  recordingId: string;
  clock: SessionClock;
  input: StartRecordingInput;
  source: CaptureSource;
}

// Turns native input into ordered screenshot evidence tied to one recording clock.
export class ClickCaptureCoordinator {
  private session: ClickCaptureSession | null = null;
  private paused = false;
  private screenshotQueue = Promise.resolve();

  constructor(
    private readonly recordings: RecordingRepository,
    private readonly assets: ManagedRecordingAssets,
    private readonly inputCapture: GlobalInputCapture,
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

  async flush(): Promise<void> {
    await this.screenshotQueue;
  }

  private record(event: GlobalMouseDownEvent): void {
    const session = this.session;

    if (!session || this.paused) return;

    const click = this.createClick(session, event);

    if (!click.insideCaptureRegion && session.input.captureMode !== "window") {
      return;
    }

    // Capture the event's session now; queued screenshots may finish after input capture stops.
    this.screenshotQueue = this.screenshotQueue
      .then(async () => {
        const screenshot = await this.captureScreenshot(session);

        if (!screenshot) {
          throw new Error("The capture source did not provide a screenshot");
        }

        if (click.normalizedX === null || click.normalizedY === null) {
          throw new Error("Unable to map the click onto its screenshot");
        }

        const screenshotPath = await this.assets.clickScreenshotPath(session.recordingId, click.id);
        const markedScreenshot = addClickMarker(
          screenshot.toPNG(),
          click.normalizedX,
          click.normalizedY,
        );

        await writeFile(screenshotPath, markedScreenshot);

        try {
          await this.recordings.insertClick({ ...click, screenshotPath });
        } catch (error) {
          // Remove the image if its database row could not be saved.
          await this.assets.deleteFile(screenshotPath);

          throw error;
        }
      })
      .catch((error: unknown) => {
        // A failed screenshot is reported without preventing later clicks from being captured.
        console.error("Unable to capture click screenshot", error);
      });
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
      recordingId: session.recordingId,
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
