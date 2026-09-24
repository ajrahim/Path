import { afterEach, beforeEach, expect, it, vi } from "vitest";
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

const startInput: StartRecordingInput = {
  sourceId: "screen:1",
  title: "Timed walkthrough",
  captureMode: "display",
  includeMicrophone: false,
  captureClicks: false,
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date("2026-09-14T10:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

function createController() {
  const recordings = {
    create: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    markFailed: vi.fn().mockResolvedValue(undefined),
    markProcessing: vi.fn().mockResolvedValue(undefined),
    markReady: vi.fn().mockResolvedValue(undefined),
    recordMediaTiming: vi.fn().mockResolvedValue(undefined),
    replaceTranscript: vi.fn().mockResolvedValue(undefined),
    markTranscriptReady: vi.fn().mockResolvedValue(undefined),
    listClicks: vi.fn().mockResolvedValue([]),
  };

  const assets = {
    createRecordingDirectory: vi.fn().mockResolvedValue("/managed/recording"),
    videoPath: vi.fn().mockReturnValue("/managed/recording/raw.webm"),
    finalVideoPath: vi.fn().mockReturnValue("/managed/recording/recording.mp4"),
    thumbnailPath: vi.fn().mockReturnValue("/managed/recording/thumbnail.png"),
  };

  const controller = new RecordingController(
    recordings as never,
    assets as never,
    { webContents: { send: vi.fn() } } as never,
    {
      finalize: vi.fn().mockResolvedValue(undefined),
      extractThumbnail: vi.fn().mockResolvedValue(undefined),
    } as never,
    {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      flush: vi.fn().mockResolvedValue(undefined),
    } as never,
    null,
  );

  return { controller, recordings };
}

it("stores the wall-clock media origin and pauses before processing", async () => {
  const { controller, recordings } = createController();

  await controller.start(startInput);

  // Capture setup latency precedes media zero and must not shift imported rows.
  vi.advanceTimersByTime(1_500);
  await controller.captureReady();
  vi.advanceTimersByTime(3_000);
  await controller.pause();
  vi.advanceTimersByTime(4_000);
  await controller.resume();
  vi.advanceTimersByTime(2_000);
  await controller.stop();
  await controller.captureComplete();

  const recordingId = recordings.create.mock.calls[0]?.[0].id;

  expect(recordings.recordMediaTiming).toHaveBeenCalledWith(recordingId, {
    startedAt: "2026-09-14T10:00:01.500Z",
    pauses: [{ atMs: 3_000, durationMs: 4_000 }],
  });
  expect(recordings.markProcessing).toHaveBeenCalledWith(recordingId, 5_000, expect.any(String));
  expect(recordings.recordMediaTiming.mock.invocationCallOrder[0]).toBeLessThan(
    recordings.markProcessing.mock.invocationCallOrder[0] ?? 0,
  );
});
