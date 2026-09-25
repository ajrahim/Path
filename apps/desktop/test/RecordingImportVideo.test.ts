import { mkdtemp, readFile, readdir, rm, unlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecordingRuntimeState, StartRecordingInput } from "@path/shared";
import { RecordingController } from "../src/recording/RecordingController";
import { ManagedRecordingAssets } from "../src/storage/ManagedRecordingAssets";

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
  Notification: { isSupported: vi.fn(() => false) },
  screen: { getAllDisplays: () => [] },
}));

const temporaryDirectories: string[] = [];
const startInput: StartRecordingInput = {
  sourceId: "screen:1",
  title: "Capture",
  captureMode: "display",
  includeMicrophone: false,
  captureClicks: false,
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

async function createController() {
  const directory = await mkdtemp(join(tmpdir(), "path-import-test-"));

  temporaryDirectories.push(directory);
  const videoPath = join(directory, "original.mov");

  await writeFile(videoPath, "source video bytes");
  await utimes(videoPath, new Date("2026-09-01T12:00:05Z"), new Date("2026-09-01T12:00:05Z"));
  const assets = new ManagedRecordingAssets();
  const root = { id: "root", path: join(directory, "managed") };

  await assets.useRoots(root, [root]);

  const recordings = {
    create: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    markFailed: vi.fn().mockResolvedValue(undefined),
    markProcessing: vi.fn().mockResolvedValue(undefined),
    markReady: vi.fn().mockResolvedValue(undefined),
    recordMediaTiming: vi.fn().mockResolvedValue(undefined),
    markTranscriptProcessing: vi.fn().mockResolvedValue(undefined),
    markTranscriptReady: vi.fn().mockResolvedValue(undefined),
    markTranscriptFailed: vi.fn().mockResolvedValue(undefined),
    replaceTranscript: vi.fn().mockResolvedValue(undefined),
    listClicks: vi.fn().mockResolvedValue([]),
    listTranscript: vi.fn().mockResolvedValue([]),
    getAssetLocation: vi.fn(async (recordingId: string) => ({
      recordingId,
      storageRootPath: root.path,
    })),
  };

  const mediaProcessor = {
    probe: vi.fn().mockResolvedValue({ durationMs: 5_000, hasAudio: true, createdAt: null }),
    finalize: vi.fn().mockResolvedValue(undefined),
    extractAudio: vi.fn().mockResolvedValue(undefined),
    extractThumbnail: vi.fn().mockResolvedValue(undefined),
  };

  const captureWorker = { webContents: { send: vi.fn() } };
  const clickCapture = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  };

  const transcriptProvider = { transcribe: vi.fn().mockResolvedValue({ segments: [] }) };
  const controller = new RecordingController(
    recordings as never,
    assets,
    captureWorker as never,
    mediaProcessor,
    clickCapture as never,
    transcriptProvider as never,
    null,
    { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  );

  const states: RecordingRuntimeState[] = [];

  controller.onStateChanged((state) => states.push(state));

  return {
    controller,
    recordings,
    assets,
    mediaProcessor,
    captureWorker,
    clickCapture,
    transcriptProvider,
    videoPath,
    states,
  };
}

describe("RecordingController video import", () => {
  it("owns a copy, transcribes it, and publishes its identity without starting capture", async () => {
    const context = await createController();
    const onProcessing = vi.fn();
    const id = await context.controller.importVideo(
      { videoPath: context.videoPath, title: "Imported tutorial" },
      onProcessing,
    );

    const rawVideoPath = context.recordings.markProcessing.mock.calls[0]?.[2];

    expect(rawVideoPath).not.toBe(context.videoPath);
    expect(await readFile(context.videoPath, "utf8")).toBe("source video bytes");
    expect(await readFile(rawVideoPath, "utf8")).toBe("source video bytes");
    expect(context.recordings.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id,
        title: "Imported tutorial",
        startedAt: "2026-09-01T12:00:00.000Z",
      }),
    );
    expect(context.recordings.recordMediaTiming).toHaveBeenCalledWith(id, {
      startedAt: "2026-09-01T12:00:00.000Z",
      pauses: [],
    });
    expect(context.transcriptProvider.transcribe).toHaveBeenCalledWith(
      expect.objectContaining({ recordingId: id, durationMs: 5_000 }),
    );
    expect(onProcessing).toHaveBeenCalledExactlyOnceWith(id);
    expect(onProcessing.mock.invocationCallOrder[0]).toBeGreaterThan(
      context.recordings.markProcessing.mock.invocationCallOrder[0]!,
    );
    expect(onProcessing.mock.invocationCallOrder[0]).toBeLessThan(
      context.mediaProcessor.finalize.mock.invocationCallOrder[0]!,
    );
    expect(context.captureWorker.webContents.send).not.toHaveBeenCalled();
    expect(context.clickCapture.start).not.toHaveBeenCalled();
    expect(context.states).toContainEqual(
      expect.objectContaining({ status: "processing", recordingId: id }),
    );
    expect(context.controller.getState()).toMatchObject({
      status: "ready",
      recordingId: id,
      elapsedMs: 5_000,
    });
  });

  it("skips transcription for silent videos and uses embedded media timing", async () => {
    const context = await createController();

    context.mediaProcessor.probe.mockResolvedValue({
      durationMs: 5_000,
      hasAudio: false,
      createdAt: "2025-12-01T08:00:00.000Z",
    });

    const id = await context.controller.importVideo({
      videoPath: context.videoPath,
      title: "Silent",
    });

    expect(context.mediaProcessor.extractAudio).not.toHaveBeenCalled();
    expect(context.transcriptProvider.transcribe).not.toHaveBeenCalled();
    expect(context.recordings.markTranscriptReady).toHaveBeenCalledWith(id);
    expect(context.recordings.recordMediaTiming).toHaveBeenCalledWith(id, {
      startedAt: "2025-12-01T08:00:00.000Z",
      pauses: [],
    });
  });

  it("rejects imports while a capture is active", async () => {
    const context = await createController();

    await context.controller.start(startInput);
    await context.controller.captureReady();

    await expect(
      context.controller.importVideo({ videoPath: context.videoPath, title: "Busy" }),
    ).rejects.toThrow("Finish the active recording");
    expect(context.mediaProcessor.probe).not.toHaveBeenCalled();
    await context.controller.captureFailed("test cleanup");
  });

  it("keeps the processing lock until the final database write completes", async () => {
    const context = await createController();
    let finishSave: () => void = () => {};

    context.recordings.markReady.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );
    const imported = context.controller.importVideo({
      videoPath: context.videoPath,
      title: "Busy",
    });

    await vi.waitFor(() => expect(context.recordings.markReady).toHaveBeenCalled());

    expect(context.controller.getState().status).toBe("processing");
    await expect(context.controller.start(startInput)).rejects.toThrow("already active");
    await expect(
      context.controller.importVideo({ videoPath: context.videoPath, title: "Second" }),
    ).rejects.toThrow("Finish the active recording");
    finishSave();
    await imported;
    expect(context.controller.getState().status).toBe("ready");
  });

  it("retains a failed import for retry after the original source has been removed", async () => {
    const context = await createController();

    context.mediaProcessor.finalize.mockRejectedValueOnce(new Error("Encoding failed"));
    await expect(
      context.controller.importVideo({ videoPath: context.videoPath, title: "Retry" }),
    ).rejects.toThrow("Encoding failed");
    const [id, durationMs, rawVideoPath] = context.recordings.markProcessing.mock.calls[0]!;

    expect(await readFile(context.videoPath, "utf8")).toBe("source video bytes");
    expect(context.controller.getState()).toMatchObject({ status: "failed", recordingId: id });
    context.recordings.get.mockResolvedValue({
      id,
      status: "failed",
      durationMs,
      videoPath: rawVideoPath,
      transcriptStatus: "pending",
    });
    await unlink(context.videoPath);
    await context.controller.retryProcessing(id);

    expect(context.mediaProcessor.finalize).toHaveBeenLastCalledWith(
      rawVideoPath,
      expect.any(String),
    );
    expect(context.controller.getState()).toMatchObject({ status: "ready", recordingId: id });
  });

  it("cleans only the owned copy when media has no valid duration", async () => {
    const context = await createController();

    context.mediaProcessor.probe.mockResolvedValue({
      durationMs: 0,
      hasAudio: false,
      createdAt: null,
    });

    await expect(
      context.controller.importVideo({ videoPath: context.videoPath, title: "Invalid" }),
    ).rejects.toThrow("no valid duration");
    expect(await readFile(context.videoPath, "utf8")).toBe("source video bytes");
    expect(await readdir(context.assets.currentRoot.path)).toEqual([]);
    expect(context.recordings.create).not.toHaveBeenCalled();
    expect(context.controller.getState().status).toBe("failed");
  });
});
