import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClickEvent } from "@path/shared";
import type { GlobalMouseDownEvent } from "../src/input/GlobalInputCapture";
import {
  ClickCaptureCoordinator,
  CLICK_CAPTURE_LIMITS,
} from "../src/recording/ClickCaptureCoordinator";

const getSources = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({
  desktopCapturer: { getSources },
  screen: {
    screenToDipPoint: (point: { x: number; y: number }) => point,
    getDisplayNearestPoint: () => ({
      id: 1,
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      scaleFactor: 1,
    }),
  },
}));

const directories: string[] = [];

afterEach(() => {
  vi.clearAllMocks();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const screenshot = PNG.sync.write(new PNG({ width: 20, height: 20 }));

function source() {
  return [
    {
      id: "screen:1",
      thumbnail: { isEmpty: () => false, toPNG: () => screenshot },
    },
  ];
}

async function startCapture(options: { maxPendingScreenshots?: number } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "path-clicks-"));

  directories.push(directory);

  let emit: (event: GlobalMouseDownEvent) => void = () => undefined;
  const stored: ClickEvent[] = [];
  const recordings = {
    insertClicks: vi.fn(async (clicks: ClickEvent[]) => {
      stored.push(...structuredClone(clicks));
    }),
  };

  const assets = {
    clickScreenshotPath: vi.fn(async (_location: unknown, clickId: string) =>
      join(directory, `click-${clickId}.png`),
    ),
    remove: vi.fn(async (path: string) => unlink(path)),
  };

  const diagnostics = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const coordinator = new ClickCaptureCoordinator(
    recordings,
    assets,
    {
      start: async (listener) => {
        emit = listener;
      },
      stop: async () => undefined,
    },
    diagnostics,
    { ...CLICK_CAPTURE_LIMITS, ...options },
    async () => undefined,
  );

  await coordinator.start({
    location: { recordingId: "4a4c2a0e-9a55-4a4f-8b53-6d1c1f1f0c01", storageRootPath: directory },
    clock: { elapsedMs: () => 1_000 } as never,
    input: {
      sourceId: "screen:1",
      title: "Clicks",
      captureMode: "display",
      includeMicrophone: false,
      captureClicks: true,
    },
    source: {
      id: "screen:1",
      name: "Screen",
      type: "screen",
      thumbnailDataUrl: "",
      displayId: "1",
      displayBounds: { x: 0, y: 0, width: 100, height: 100 },
      scaleFactor: 1,
    },
  });

  return {
    coordinator,
    recordings,
    assets,
    diagnostics,
    stored,
    click: (x: number) => emit({ x, y: 10, button: "left" }),
  };
}

describe("ClickCaptureCoordinator", () => {
  it("keeps clicks without screenshots instead of dropping them under backpressure", async () => {
    let releaseScreenshot!: () => void;

    getSources.mockImplementationOnce(
      () => new Promise((resolve) => (releaseScreenshot = () => resolve(source()))),
    );

    const capture = await startCapture({ maxPendingScreenshots: 1 });

    capture.click(10);
    capture.click(20);
    capture.click(30);
    await vi.waitFor(() => expect(getSources).toHaveBeenCalledOnce());
    releaseScreenshot();

    await expect(capture.coordinator.flush()).resolves.toEqual({ unsavedClickCount: 0 });

    const byX = Object.fromEntries(capture.stored.map((click) => [click.globalX, click]));

    expect(capture.stored).toHaveLength(3);
    expect(existsSync(byX[10]!.screenshotPath!)).toBe(true);
    expect(byX[20]!.screenshotPath).toBeNull();
    expect(byX[30]!.screenshotPath).toBeNull();
    expect(capture.diagnostics.warn).toHaveBeenCalledTimes(2);
  });

  it("stores a click whose screenshot could not be captured", async () => {
    getSources.mockRejectedValueOnce(new Error("Capture source closed"));

    const capture = await startCapture();

    capture.click(10);
    await capture.coordinator.flush();

    expect(capture.stored).toEqual([
      expect.objectContaining({ globalX: 10, screenshotPath: null }),
    ]);
  });

  it("retries a failed write and stores the batch once it succeeds", async () => {
    getSources.mockResolvedValue(source());

    const capture = await startCapture();

    capture.recordings.insertClicks
      .mockRejectedValueOnce(new Error("database busy"))
      .mockRejectedValueOnce(new Error("database busy"));
    capture.click(10);
    capture.click(20);

    await expect(capture.coordinator.flush()).resolves.toEqual({ unsavedClickCount: 0 });
    expect(capture.stored.map((click) => click.globalX)).toEqual([10, 20]);
    expect(capture.diagnostics.warn).toHaveBeenCalledTimes(2);
  });

  it("reports clicks that still cannot be stored and removes their screenshots", async () => {
    getSources.mockResolvedValue(source());

    const capture = await startCapture();

    capture.recordings.insertClicks.mockRejectedValue(new Error("database unavailable"));
    capture.click(10);

    await expect(capture.coordinator.flush()).resolves.toEqual({ unsavedClickCount: 1 });
    expect(capture.assets.remove).toHaveBeenCalledOnce();
    expect(capture.diagnostics.error).toHaveBeenCalled();
    expect(capture.stored).toEqual([]);
  });
});
