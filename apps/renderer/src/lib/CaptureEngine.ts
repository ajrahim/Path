import type { CaptureWorkerStart } from "@path/shared";
import { getDesktopApi } from "@/lib/Desktop";

interface ElectronDesktopConstraints extends MediaTrackConstraints {
  mandatory: { chromeMediaSource: "desktop"; chromeMediaSourceId: string; maxFrameRate: number };
}

function preferredMimeType(): string | undefined {
  return ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find(
    (mimeType) => MediaRecorder.isTypeSupported(mimeType),
  );
}

async function desktopStream(sourceId: string): Promise<MediaStream> {
  // Electron capture IDs use Chromium's desktop constraints rather than a camera device ID.
  const video: ElectronDesktopConstraints = {
    mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: sourceId, maxFrameRate: 30 },
  };

  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: video as MediaTrackConstraints,
  });
}

async function croppedStream(
  source: MediaStream,
  input: CaptureWorkerStart,
): Promise<{ stream: MediaStream; dispose(): void }> {
  if (!input.captureRegion || !input.displayBounds) {
    return { stream: source, dispose: () => undefined };
  }

  const video = document.createElement("video");

  video.muted = true;
  video.srcObject = source;
  await video.play();

  // Convert desktop coordinates into decoded video pixels before drawing the crop.
  const { captureRegion, displayBounds } = input;
  const sourceX = ((captureRegion.x - displayBounds.x) / displayBounds.width) * video.videoWidth;
  const sourceY = ((captureRegion.y - displayBounds.y) / displayBounds.height) * video.videoHeight;
  const sourceWidth = (captureRegion.width / displayBounds.width) * video.videoWidth;
  const sourceHeight = (captureRegion.height / displayBounds.height) * video.videoHeight;
  const canvas = document.createElement("canvas");

  canvas.width = Math.max(1, Math.round(sourceWidth));
  canvas.height = Math.max(1, Math.round(sourceHeight));
  const context = canvas.getContext("2d", { alpha: false });

  if (!context) throw new Error("Canvas capture is unavailable");

  let active = true;
  let frameId = 0;
  const drawFrame = () => {
    if (!active) return;

    context.drawImage(
      video,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    frameId = video.requestVideoFrameCallback(drawFrame);
  };

  frameId = video.requestVideoFrameCallback(drawFrame);
  const stream = canvas.captureStream(30);

  return {
    stream,
    dispose: () => {
      active = false;
      video.cancelVideoFrameCallback(frameId);
      video.pause();
      video.srcObject = null;
    },
  };
}

/** Owns a capture worker's tracks, crop callback, and ordered stream of media chunks. */
export class CaptureEngine {
  private recorder: MediaRecorder | null = null;
  private tracks: MediaStreamTrack[] = [];
  private disposeCrop: () => void = () => undefined;
  private chunkQueue = Promise.resolve();

  async start(input: CaptureWorkerStart): Promise<void> {
    if (this.recorder) throw new Error("Capture engine is already recording");

    const desktop = getDesktopApi();

    if (!desktop) throw new Error("Desktop capture bridge is unavailable");

    try {
      const displayStream = await desktopStream(input.sourceId);

      this.tracks.push(...displayStream.getTracks());
      const videoCapture =
        input.captureMode === "region"
          ? await croppedStream(displayStream, input)
          : { stream: displayStream, dispose: () => undefined };

      this.disposeCrop = videoCapture.dispose;

      const microphone = input.includeMicrophone
        ? await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
            video: false,
          })
        : null;

      if (microphone) this.tracks.push(...microphone.getTracks());

      const output = new MediaStream([
        ...videoCapture.stream.getVideoTracks(),
        ...(microphone?.getAudioTracks() ?? []),
      ]);

      const mimeType = preferredMimeType();

      this.recorder = new MediaRecorder(output, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: 6_000_000,
      });
      this.recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size === 0) return;

        // IPC writes must preserve MediaRecorder order even when blob conversion is asynchronous.
        this.chunkQueue = this.chunkQueue.then(async () => {
          const chunk = new Uint8Array(await event.data.arrayBuffer());

          await desktop.capture.appendChunk(chunk);
        });
      });
      this.recorder.addEventListener(
        "stop",
        () => {
          void this.finish();
        },
        { once: true },
      );
      this.recorder.start(1_000);
      await desktop.capture.ready();
    } catch (error) {
      await this.fail(error);
    }
  }

  stop(): void {
    if (this.recorder?.state === "recording" || this.recorder?.state === "paused") {
      this.recorder.stop();
    }
  }

  pause(): void {
    if (this.recorder?.state === "recording") {
      this.recorder.pause();
    }
  }

  resume(): void {
    if (this.recorder?.state === "paused") {
      this.recorder.resume();
    }
  }

  private async finish(): Promise<void> {
    const desktop = getDesktopApi();

    try {
      // The final dataavailable event must reach disk before the desktop completes processing.
      await this.chunkQueue;
      await desktop?.capture.complete();
    } catch (error) {
      await this.fail(error);

      return;
    } finally {
      this.cleanup();
    }
  }

  private async fail(error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : "Screen capture failed";

    this.cleanup();
    await getDesktopApi()?.capture.fail(message);
  }

  private cleanup(): void {
    this.disposeCrop();
    this.tracks.forEach((track) => track.stop());
    this.tracks = [];
    this.recorder = null;
    this.disposeCrop = () => undefined;
    this.chunkQueue = Promise.resolve();
  }
}
