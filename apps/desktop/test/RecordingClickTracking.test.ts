import { describe, expect, it, vi } from "vitest";
import { RecordingController } from "../src/recording/RecordingController";

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
  desktopCapturer: {},
  Notification: {},
  screen: {},
}));

async function setup() {
  const capture = { start: vi.fn(), stop: vi.fn() };
  const controller = new RecordingController(
    { create: vi.fn() } as never,
    {
      createRecordingDirectory: vi.fn(),
      videoPath: () => "raw.webm",
      finalVideoPath: () => "final.mp4",
    } as never,
    { webContents: { send: vi.fn() } } as never,
    {} as never,
    capture as never,
    null,
  );

  vi.spyOn(controller, "listSources").mockResolvedValue([
    {
      id: "screen:1",
      name: "Screen",
      type: "screen",
      thumbnailDataUrl: "",
      displayId: "1",
      displayBounds: null,
      scaleFactor: 1,
    },
  ]);
  await controller.start({
    sourceId: "screen:1",
    title: "Test",
    captureMode: "display",
    includeMicrophone: false,
    captureClicks: false,
  });
  await controller.captureReady();

  return { controller, capture };
}

describe("recording click tracking", () => {
  it("toggles capture while preserving the recording session and paused preference", async () => {
    const { controller, capture } = await setup();
    const id = controller.getState().recordingId;

    expect(capture.start).not.toHaveBeenCalled();
    expect((await controller.setClickTracking(true)).captureClicks).toBe(true);
    expect(capture.start).toHaveBeenCalledTimes(1);
    await controller.pause();
    await controller.setClickTracking(false);
    await controller.resume();
    expect(capture.start).toHaveBeenCalledTimes(1);
    await controller.setClickTracking(true);
    expect(capture.start).toHaveBeenCalledTimes(2);
    expect(controller.getState()).toMatchObject({
      recordingId: id,
      status: "recording",
      captureClicks: true,
    });
    await controller.setClickTracking(false);
  });

  it("does not restart tracking when pause overtakes a pending enable", async () => {
    const { controller, capture } = await setup();
    const enabling = controller.setClickTracking(true);
    const pausing = controller.pause();

    await Promise.all([enabling, pausing]);
    expect(capture.start).not.toHaveBeenCalled();
    expect(controller.getState().status).toBe("paused");
  });

  it("keeps recording and switches tracking off if the native hook fails", async () => {
    const { controller, capture } = await setup();

    capture.start.mockRejectedValueOnce(new Error("Hook unavailable"));
    expect(await controller.setClickTracking(true)).toMatchObject({
      status: "recording",
      captureClicks: false,
      error: "Hook unavailable",
    });
  });
});
