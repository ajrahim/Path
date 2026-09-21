import { randomUUID } from "node:crypto";
import { appendFile, stat } from "node:fs/promises";
import {
  BrowserWindow,
  desktopCapturer,
  Notification,
  screen,
  type DesktopCapturerSource,
} from "electron";
import { SessionClock, transitionRecordingState, type RecordingState } from "@path/recording-core";
import type { RecordingRepository } from "@path/database";
import {
  IPC_CHANNELS,
  type CaptureSource,
  type CaptureWorkerStart,
  type ClickAnalysisResult,
  type RecordingRuntimeState,
  type StartRecordingInput,
} from "@path/shared";
import type { ManagedRecordingAssets } from "../storage/ManagedRecordingAssets";
import messages from "@path/shared/messages/en.json";
import type { MediaProcessor } from "../media/FfmpegMediaProcessor";
import type { ClickCaptureCoordinator } from "./ClickCaptureCoordinator";
import type { TranscriptProvider } from "@path/transcription";
import {
  needsClickActionAnalysis,
  type ClickActionAnalyzer,
} from "../ai/OllamaClickActionAnalyzer";
import { AiRateLimitError } from "../ai/SelectedAiService";

interface ActiveRecording {
  id: string;
  input: StartRecordingInput;
  rawVideoPath: string;
  finalVideoPath: string;
  source: CaptureSource;
}

const MINIMUM_RECORDING_DURATION_MS = 2_000;
const MAX_CLICK_ANALYSES_PER_RECORDING = 200;

// Owns recording transitions while adapters handle capture, media files, and analysis.
export class RecordingController {
  private state: RecordingState = "IDLE";
  private active: ActiveRecording | null = null;
  private clock: SessionClock | null = null;
  private writeQueue = Promise.resolve();
  private clickCaptureQueue = Promise.resolve();
  private error: string | null = null;
  private stateListener: ((state: RecordingRuntimeState) => void) | null = null;
  private preparationTimer: NodeJS.Timeout | null = null;
  private readonly clickAnalysisJobs = new Map<string, Promise<ClickAnalysisResult>>();

  constructor(
    private readonly recordings: RecordingRepository,
    private readonly assets: ManagedRecordingAssets,
    private readonly captureWorker: BrowserWindow,
    private readonly mediaProcessor: MediaProcessor,
    private readonly clickCapture: ClickCaptureCoordinator,
    private readonly transcriptProvider: TranscriptProvider | null,
    private readonly clickActionAnalyzer: ClickActionAnalyzer | null = null,
  ) {}

  onStateChanged(listener: (state: RecordingRuntimeState) => void): void {
    this.stateListener = listener;
    listener(this.getState());
  }

  async listSources(): Promise<CaptureSource[]> {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      fetchWindowIcons: true,
      thumbnailSize: { width: 320, height: 180 },
    });

    const displays = screen.getAllDisplays();

    return sources.map((source) => {
      const display = displays.find((candidate) => candidate.id.toString() === source.display_id);

      return {
        id: source.id,
        name: source.name,
        type: source.id.startsWith("screen:") ? "screen" : "window",
        thumbnailDataUrl: source.thumbnail.toDataURL(),
        displayId: display?.id.toString() ?? null,
        displayBounds: display ? { ...display.bounds } : null,
        scaleFactor: display?.scaleFactor ?? null,
      };
    });
  }

  async selectedDesktopSource(): Promise<DesktopCapturerSource | null> {
    if (!this.active) return null;

    const sources = await desktopCapturer.getSources({ types: ["screen", "window"] });

    return sources.find((source) => source.id === this.active?.input.sourceId) ?? null;
  }

  async start(input: StartRecordingInput): Promise<RecordingRuntimeState> {
    if (this.state === "READY" || this.state === "FAILED") {
      this.state = transitionRecordingState(this.state, "RESET");
      this.clearActiveSession();
    }

    if (this.state !== "IDLE") {
      throw new Error("A recording is already active");
    }

    const source = (await this.listSources()).find((candidate) => candidate.id === input.sourceId);

    if (!source) {
      throw new Error("The selected capture source is no longer available");
    }

    if (input.captureMode === "region" && !input.captureRegion) {
      throw new Error("A capture region is required for region recording");
    }

    const id = randomUUID();
    let directoryCreated = false;
    let rowCreated = false;

    this.state = transitionRecordingState(this.state, "PREPARE");
    this.error = null;

    try {
      await this.assets.createRecordingDirectory(id);
      directoryCreated = true;

      const rawVideoPath = this.assets.videoPath(id);
      const finalVideoPath = this.assets.finalVideoPath(id);
      const startedAt = new Date().toISOString();

      await this.recordings.create({
        id,
        title: input.title,
        captureMode: input.captureMode,
        captureRegion: input.captureRegion,
        startedAt,
      });
      rowCreated = true;

      this.active = { id, input, rawVideoPath, finalVideoPath, source };
      this.clock = null;
      this.writeQueue = Promise.resolve();
      this.emitState();

      const workerInput: CaptureWorkerStart = {
        ...input,
        recordingId: id,
        displayBounds: source.displayBounds,
      };

      this.captureWorker.webContents.send(IPC_CHANNELS.captureStartRequested, workerInput);

      // A worker that never acknowledges startup must not leave the UI preparing forever.
      this.preparationTimer = setTimeout(() => {
        this.captureWorker.webContents.send(IPC_CHANNELS.captureStopRequested);
        void this.captureFailed("Screen capture did not start within 15 seconds");
      }, 15_000);

      return this.getState();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Recording preparation failed";

      // Roll back only the resources this attempt actually created.
      if (rowCreated) await this.recordings.markFailed(id);
      if (directoryCreated) await this.assets.delete(id);

      this.error = message;
      this.state = transitionRecordingState(this.state, "FAIL");
      this.clearActiveSession();
      this.emitState();

      throw error;
    }
  }

  async pause(): Promise<RecordingRuntimeState> {
    if (this.state !== "RECORDING") {
      return this.getState();
    }

    this.state = transitionRecordingState(this.state, "PAUSE");
    this.clock?.pause();
    await this.syncClickCapture();
    this.emitState();
    this.captureWorker.webContents.send(IPC_CHANNELS.capturePauseRequested);

    return this.getState();
  }

  async resume(): Promise<RecordingRuntimeState> {
    if (this.state !== "PAUSED") {
      return this.getState();
    }

    this.state = transitionRecordingState(this.state, "RESUME");
    this.clock?.resume();
    await this.syncClickCapture();
    this.emitState();
    this.captureWorker.webContents.send(IPC_CHANNELS.captureResumeRequested);

    return this.getState();
  }

  async stop(): Promise<RecordingRuntimeState> {
    if (this.state !== "RECORDING" && this.state !== "PAUSED") {
      return this.getState();
    }

    // Ignore very early stop requests while the encoder is still establishing usable media.
    if ((this.clock?.elapsedMs() ?? 0) < MINIMUM_RECORDING_DURATION_MS) {
      return this.getState();
    }

    this.state = transitionRecordingState(this.state, "STOP");
    await this.syncClickCapture();
    this.emitState();
    this.captureWorker.webContents.send(IPC_CHANNELS.captureStopRequested);

    return this.getState();
  }

  async captureReady(): Promise<void> {
    if (this.state !== "PREPARING") return;

    // Start media-relative time at the worker acknowledgement, excluding setup latency.
    this.clearPreparationTimer();
    this.clock = new SessionClock();
    this.state = transitionRecordingState(this.state, "PREPARED");
    this.emitState();

    try {
      await this.syncClickCapture();
    } catch (error) {
      await this.captureFailed(error instanceof Error ? error.message : "Click capture failed");
    }
  }

  async setClickTracking(enabled: boolean): Promise<RecordingRuntimeState> {
    if (!this.active || (this.state !== "RECORDING" && this.state !== "PAUSED")) {
      return this.getState();
    }

    this.active.input.captureClicks = enabled;
    try {
      await this.syncClickCapture();
    } catch (error) {
      this.active.input.captureClicks = false;
      this.error = error instanceof Error ? error.message : "Click capture failed";
      await this.syncClickCapture();
    }

    this.emitState();

    return this.getState();
  }

  private syncClickCapture(): Promise<void> {
    // Serialize native hook changes so a pending enable cannot outlive pause or stop.
    const update = this.clickCaptureQueue.then(async () => {
      await this.clickCapture.stop();
      if (this.state === "RECORDING" && this.active?.input.captureClicks && this.clock) {
        await this.clickCapture.start({
          recordingId: this.active.id,
          clock: this.clock,
          input: this.active.input,
          source: this.active.source,
        });
      }
    });

    // Callers handle failures; keep subsequent cleanup commands runnable.
    this.clickCaptureQueue = update.catch(() => {});

    return update;
  }

  appendChunk(chunk: Uint8Array): Promise<void> {
    if (!this.active) {
      throw new Error("No active recording accepts media chunks");
    }

    if (chunk.byteLength > 32 * 1024 * 1024) {
      throw new Error("Recording chunk is too large");
    }

    const videoPath = this.active.rawVideoPath;

    // Chunks arrive over independent IPC calls but must be appended in arrival order.
    this.writeQueue = this.writeQueue.then(() => appendFile(videoPath, chunk));

    return this.writeQueue;
  }

  async captureComplete(): Promise<void> {
    if (!this.active || this.state !== "STOPPING") return;

    // Drain media and screenshot writes before publishing processing or ready state.
    await this.writeQueue;
    await this.clickCapture.flush();
    const durationMs = Math.round(this.clock?.elapsedMs() ?? 0);

    this.state = transitionRecordingState(this.state, "STOPPED");
    this.emitState();
    await this.recordings.markProcessing(this.active.id, durationMs, this.active.rawVideoPath);

    try {
      const finalThumbnailPath = await this.finalizeVideoFiles(
        this.active.id,
        this.active.rawVideoPath,
        this.active.finalVideoPath,
      );

      await this.processTranscript(this.active);
      await this.processClickActions(this.active);
      await this.recordings.markReady(
        this.active.id,
        new Date().toISOString(),
        this.active.finalVideoPath,
        finalThumbnailPath,
      );

      this.emitState();

      if (Notification.isSupported()) {
        new Notification({
          title: messages.app.name,
          body: messages.recording.completeNotification,
        }).show();
      }
    } catch (error) {
      await this.captureFailed(error instanceof Error ? error.message : "Video processing failed");
    }
  }

  /** Reprocesses a failed recording from its retained capture without a new recording session. */
  async retryProcessing(recordingId: string): Promise<void> {
    if (this.active) {
      throw new Error("Finish the active recording before retrying");
    }

    if (this.state !== "IDLE" && this.state !== "READY" && this.state !== "FAILED") {
      throw new Error("Processing can only be retried when no recording is active");
    }

    const session = await this.recordings.get(recordingId);

    if (!session) throw new Error(`Recording not found: ${recordingId}`);

    if (session.status !== "failed") {
      throw new Error("Only failed recordings can be reprocessed");
    }

    // The stored path may reference the raw capture or an earlier managed root.
    const rawVideoPath =
      session.videoPath?.endsWith(".webm") === true
        ? session.videoPath
        : this.assets.videoPath(session.id);

    if (!this.assets.isManagedFile(rawVideoPath)) {
      throw new Error("The original capture is outside the managed recording directories");
    }

    try {
      await stat(rawVideoPath);
    } catch {
      throw new Error("The original capture is no longer available");
    }

    this.state = transitionRecordingState(this.state, "RETRY_PROCESSING");
    this.error = null;
    this.emitState();

    const durationMs = session.durationMs ?? 0;
    const finalVideoPath = this.assets.finalVideoPath(session.id);

    await this.recordings.markProcessing(session.id, durationMs, rawVideoPath);

    try {
      const finalThumbnailPath = await this.finalizeVideoFiles(
        session.id,
        rawVideoPath,
        finalVideoPath,
      );

      await this.retryTranscript(session.id, rawVideoPath, durationMs);
      await this.analyzeClicks(session.id);
      await this.recordings.markReady(
        session.id,
        new Date().toISOString(),
        finalVideoPath,
        finalThumbnailPath,
      );
      this.emitState();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Video processing failed";

      await this.recordings.markFailed(session.id);
      this.error = message;
      this.state = transitionRecordingState(this.state, "FAIL");
      this.emitState();

      throw error;
    }
  }

  private async finalizeVideoFiles(
    recordingId: string,
    rawVideoPath: string,
    finalVideoPath: string,
  ): Promise<string | undefined> {
    await this.mediaProcessor.finalize(rawVideoPath, finalVideoPath);
    const thumbnailPath = this.assets.thumbnailPath(recordingId);

    try {
      await this.mediaProcessor.extractThumbnail(finalVideoPath, thumbnailPath);

      return thumbnailPath;
    } catch (thumbnailError) {
      console.warn("Failed to generate video thumbnail", thumbnailError);

      return undefined;
    }
  }

  private async retryTranscript(
    recordingId: string,
    rawVideoPath: string,
    durationMs: number,
  ): Promise<void> {
    const session = await this.recordings.get(recordingId);

    // A completed transcript survives a later video failure; only missing work reruns.
    if (session?.transcriptStatus === "ready") {
      this.state = transitionRecordingState(this.state, "SKIP_TRANSCRIPTION");

      return;
    }

    if (!this.transcriptProvider) {
      await this.recordings.markTranscriptFailed(recordingId);
      this.state = transitionRecordingState(this.state, "SKIP_TRANSCRIPTION");

      return;
    }

    this.state = transitionRecordingState(this.state, "VIDEO_PROCESSED");
    this.emitState();
    const audioPath = this.assets.audioPath(recordingId);

    await this.recordings.markTranscriptProcessing(recordingId, audioPath);

    try {
      await this.mediaProcessor.extractAudio(rawVideoPath, audioPath);

      const transcript = await this.transcriptProvider.transcribe({
        recordingId,
        path: audioPath,
        mimeType: "audio/wav",
        durationMs,
      });

      await this.recordings.replaceTranscript(recordingId, transcript.segments);
      await this.recordings.markTranscriptReady(recordingId);
      this.state = transitionRecordingState(this.state, "TRANSCRIBED");
      this.state = transitionRecordingState(this.state, "EVENTS_INDEXED");
    } catch (error) {
      // A transcription failure is recorded separately so the captured video remains usable.
      console.error("Local transcription failed", error);
      await this.recordings.markTranscriptFailed(recordingId);
      this.state = transitionRecordingState(this.state, "TRANSCRIPTION_FAILED");
    }
  }

  private async processTranscript(active: ActiveRecording): Promise<void> {
    if (!active.input.includeMicrophone) {
      await this.recordings.replaceTranscript(active.id, []);
      await this.recordings.markTranscriptReady(active.id);
      this.state = transitionRecordingState(this.state, "SKIP_TRANSCRIPTION");

      return;
    }

    if (!this.transcriptProvider) {
      await this.recordings.markTranscriptFailed(active.id);
      this.state = transitionRecordingState(this.state, "SKIP_TRANSCRIPTION");

      return;
    }

    this.state = transitionRecordingState(this.state, "VIDEO_PROCESSED");
    this.emitState();
    const audioPath = this.assets.audioPath(active.id);

    await this.recordings.markTranscriptProcessing(active.id, audioPath);

    try {
      await this.mediaProcessor.extractAudio(active.rawVideoPath, audioPath);

      const transcript = await this.transcriptProvider.transcribe({
        recordingId: active.id,
        path: audioPath,
        mimeType: "audio/wav",
        durationMs: Math.round(this.clock?.elapsedMs() ?? 0),
      });

      await this.recordings.replaceTranscript(active.id, transcript.segments);
      await this.recordings.markTranscriptReady(active.id);
      this.state = transitionRecordingState(this.state, "TRANSCRIBED");
      this.state = transitionRecordingState(this.state, "EVENTS_INDEXED");
    } catch (error) {
      // A transcription failure is recorded separately so the captured video remains usable.
      console.error("Local transcription failed", error);
      await this.recordings.markTranscriptFailed(active.id);
      this.state = transitionRecordingState(this.state, "TRANSCRIPTION_FAILED");
    }
  }

  private async processClickActions(active: ActiveRecording): Promise<void> {
    if (!this.clickActionAnalyzer) return;

    await this.analyzeClicks(active.id);
  }

  analyzeClicks(recordingId: string): Promise<ClickAnalysisResult> {
    // Share only the in-flight job; remove it on completion so a later retry can run.
    const existing = this.clickAnalysisJobs.get(recordingId);

    if (existing) return existing;

    const job = this.runClickAnalysis(recordingId).finally(() => {
      this.clickAnalysisJobs.delete(recordingId);
    });

    this.clickAnalysisJobs.set(recordingId, job);

    return job;
  }

  private async runClickAnalysis(recordingId: string): Promise<ClickAnalysisResult> {
    const [allClicks, transcript] = await Promise.all([
      this.recordings.listClicks(recordingId),
      // Narration adds context but is not required for screenshot-based analysis.
      this.recordings.listTranscript(recordingId).catch(() => []),
    ]);

    const clicks = allClicks.slice(0, MAX_CLICK_ANALYSES_PER_RECORDING);
    const pending = clicks.filter(
      (click) => click.screenshotPath && needsClickActionAnalysis(click.actionDescription),
    );

    const analyzer = this.clickActionAnalyzer;

    if (!analyzer) {
      return { clicks: allClicks, analyzedCount: 0, failedCount: pending.length };
    }

    let analyzedCount = 0;
    let failedCount = 0;

    // Analyze in order so successful earlier steps can inform the following click.
    for (const [index, click] of pending.entries()) {
      const screenshotPath = click.screenshotPath;

      if (!screenshotPath) continue;

      try {
        const description = await analyzer.analyze({
          screenshotPath,
          timestampMs: click.timestampMs,
          button: click.button,
          normalizedX: click.normalizedX,
          normalizedY: click.normalizedY,
          previousSteps: clicks
            .filter(
              (candidate) =>
                candidate.timestampMs < click.timestampMs &&
                candidate.actionDescription &&
                candidate.actionDescription !== "Unknown control" &&
                !needsClickActionAnalysis(candidate.actionDescription),
            )
            .slice(-5)
            .map((candidate) => ({
              button: candidate.button,
              description: candidate.actionDescription!,
            })),
          transcriptContext: transcript
            .filter((segment) => segment.startMs <= click.timestampMs)
            .slice(-3)
            .map((segment) => segment.text),
        });

        await this.recordings.updateClickActionDescription(click.id, description);
        click.actionDescription = description;
        analyzedCount += 1;
      } catch (error) {
        if (error instanceof AiRateLimitError) {
          // Stop the batch on throttling instead of repeatedly hitting the same provider limit.
          console.warn(
            `AI click analysis paused after rate limiting; retry after ${Math.ceil(error.retryAfterMs / 1_000)} seconds.`,
          );
          failedCount += pending.length - index;
          break;
        }

        console.error(`AI analysis failed for click ${click.id}`, error);
        failedCount += 1;
      }
    }

    return { clicks: await this.recordings.listClicks(recordingId), analyzedCount, failedCount };
  }

  async captureFailed(message: string): Promise<void> {
    this.clearPreparationTimer();
    this.error = message;
    await this.clickCaptureQueue;
    await this.clickCapture.stop();
    const failedRecording = this.active;

    if (failedRecording) {
      await this.recordings.markFailed(failedRecording.id);

      // Only preparation artifacts are disposable here; later failures retain captured media.
      if (this.state === "PREPARING") {
        await this.assets.delete(failedRecording.id);
      }
    }

    if (this.state !== "FAILED") {
      try {
        this.state = transitionRecordingState(this.state, "FAIL");
      } catch {
        this.state = "FAILED";
      }
    }

    if (this.state === "FAILED" && failedRecording && !this.clock) {
      this.clearActiveSession();
    }

    this.emitState();
  }

  getState(): RecordingRuntimeState {
    const statusMap: Record<RecordingState, RecordingRuntimeState["status"]> = {
      IDLE: "idle",
      SELECTING_REGION: "preparing",
      PREPARING: "preparing",
      RECORDING: "recording",
      PAUSED: "paused",
      STOPPING: "stopping",
      PROCESSING_VIDEO: "processing",
      TRANSCRIBING: "processing",
      INDEXING_EVENTS: "processing",
      READY: "ready",
      FAILED: "failed",
    };

    return {
      status: statusMap[this.state],
      recordingId: this.active?.id ?? null,
      elapsedMs: Math.round(this.clock?.elapsedMs() ?? 0),
      captureClicks: this.active?.input.captureClicks ?? false,
      error: this.error,
    };
  }

  private emitState(): void {
    const state = this.getState();

    this.stateListener?.(state);

    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.recordingStateChanged, state);
      }
    }
  }

  private clearPreparationTimer(): void {
    if (this.preparationTimer) clearTimeout(this.preparationTimer);
    this.preparationTimer = null;
  }

  private clearActiveSession(): void {
    this.clearPreparationTimer();
    this.active = null;
    this.clock = null;
    this.writeQueue = Promise.resolve();
  }
}
