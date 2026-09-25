import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { StartRecordingInput } from "@path/shared";
import { RecordingController } from "../src/recording/RecordingController";

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
  desktopCapturer: {
    getSources: async () => [
      {
        id: "screen:1",
        name: "Screen 1",
        thumbnail: { toDataURL: () => "" },
        display_id: "1",
      },
    ],
  },
  Notification: { isSupported: () => false },
  screen: {
    getAllDisplays: () => [
      { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 },
    ],
  },
}));

function createController() {
  const recordings = {
    create: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    markFailed: vi.fn().mockResolvedValue(undefined),
    markProcessing: vi.fn().mockResolvedValue(undefined),
    markReady: vi.fn().mockResolvedValue(undefined),
    listClicks: vi.fn().mockResolvedValue([]),
    listTranscript: vi.fn().mockResolvedValue([]),
    getAssetLocation: vi.fn(async (recordingId: string) => ({
      recordingId,
      storageRootPath: "/managed",
    })),
  };

  const assets = {
    currentRoot: { id: "root", path: "/managed" },
    createRecordingDirectory: vi.fn().mockResolvedValue("/managed/recording-1"),
    videoPath: vi.fn().mockReturnValue(fileURLToPath(import.meta.url)),
    finalVideoPath: vi.fn().mockReturnValue("/managed/recording-1/recording.mp4"),
    thumbnailPath: vi.fn().mockReturnValue("/managed/recording-1/thumbnail.png"),
    audioPath: vi.fn().mockReturnValue("/managed/recording-1/audio.wav"),
    isManagedFile: vi.fn().mockReturnValue(true),
  };

  const captureWorker = { webContents: { send: vi.fn() } };

  const mediaProcessor = {
    probe: vi.fn().mockResolvedValue({ durationMs: 5_000, hasAudio: true, createdAt: null }),
    finalize: vi.fn().mockResolvedValue(undefined),
    extractAudio: vi.fn().mockResolvedValue(undefined),
    extractThumbnail: vi.fn().mockResolvedValue(undefined),
  };

  const clickCapture = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    flush: vi.fn().mockResolvedValue({ unsavedClickCount: 0 }),
  };

  const controller = new RecordingController(
    recordings as never,
    assets as never,
    captureWorker as never,
    mediaProcessor as never,
    clickCapture as never,
    null,
    null,
    { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  );

  return { controller, recordings };
}

const startInput: StartRecordingInput = {
  sourceId: "screen:1",
  title: "Failed walkthrough",
  captureMode: "display",
  includeMicrophone: false,
  captureClicks: false,
};

describe("RecordingController retry processing", () => {
  it("reprocesses a failed recording from the same session without a new capture", async () => {
    const { controller, recordings } = createController();

    await controller.start(startInput);
    await controller.captureReady();
    await controller.captureFailed("Screen capture failed");

    expect(controller.getState().status).toBe("failed");

    recordings.get.mockResolvedValue({
      id: "recording-1",
      status: "failed",
      videoPath: "/managed/recording-1/recording.mp4",
      durationMs: 5_000,
      transcriptStatus: "ready",
    });

    await expect(controller.retryProcessing("recording-1")).resolves.toBeUndefined();

    expect(recordings.markProcessing).toHaveBeenCalledWith(
      "recording-1",
      5_000,
      expect.any(String),
    );
    expect(recordings.markReady).toHaveBeenCalled();
    expect(controller.getState().status).toBe("ready");
  });

  it("refuses to retry while a recording is still capturing", async () => {
    const { controller } = createController();

    await controller.start(startInput);
    await controller.captureReady();

    await expect(controller.retryProcessing("recording-1")).rejects.toThrow(
      "Finish the active recording before retrying",
    );

    await controller.captureFailed("cleanup");
  });
});
