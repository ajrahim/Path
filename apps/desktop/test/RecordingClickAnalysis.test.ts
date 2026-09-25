import { describe, expect, it, vi } from "vitest";
import type { ClickEvent } from "@path/shared";
import { AiRateLimitError } from "../src/ai/SelectedAiService";
import { RecordingController } from "../src/recording/RecordingController";

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
  desktopCapturer: {},
  Notification: {},
  screen: {},
}));

function click(
  id: string,
  actionDescription: string | null,
  timestampMs = 1_000,
  button: ClickEvent["button"] = "left",
): ClickEvent {
  return {
    id,
    recordingId: "recording-1",
    timestampMs,
    button,
    globalX: 1,
    globalY: 1,
    displayId: "1",
    displayX: 1,
    displayY: 1,
    captureX: 1,
    captureY: 1,
    videoX: 1,
    videoY: 1,
    normalizedX: 0.5,
    normalizedY: 0.5,
    recordingFrameWidth: 100,
    recordingFrameHeight: 100,
    insideCaptureRegion: true,
    screenshotPath: `${id}.png`,
    actionDescription,
    createdAt: "2026-09-05T00:00:00.000Z",
  };
}

describe("RecordingController click analysis", () => {
  it("backfills invalid descriptions and continues after one click fails", async () => {
    const clicks = [
      click("failed-click", null),
      click("valid-click", "Submit button"),
      click("legacy-click", "I need the screenshot to identify the UI control"),
    ];

    const recordings = {
      listClicks: vi.fn().mockResolvedValue(clicks),
      listTranscript: vi.fn().mockResolvedValue([]),
      updateClickActionDescription: vi
        .fn()
        .mockImplementation(async (id: string, description: string) => {
          const item = clicks.find((candidate) => candidate.id === id);

          if (item) item.actionDescription = description;
        }),
    };

    const analyzer = {
      analyze: vi
        .fn()
        .mockRejectedValueOnce(new Error("Unreadable screenshot"))
        .mockResolvedValueOnce("Filter button"),
    };

    const controller = new RecordingController(
      recordings as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      null,
      analyzer,
      { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    );

    await expect(controller.analyzeClicks("recording-1")).resolves.toEqual({
      clicks,
      analyzedCount: 1,
      failedCount: 1,
    });
    expect(analyzer.analyze).toHaveBeenCalledTimes(2);
    expect(recordings.updateClickActionDescription).toHaveBeenCalledWith(
      "legacy-click",
      "Filter button",
    );
  });

  it("stops sending remaining clicks after persistent rate limiting", async () => {
    const clicks = [
      click("rate-limited-click", null),
      click("queued-click-1", null),
      click("queued-click-2", null),
    ];

    const recordings = {
      listClicks: vi.fn().mockResolvedValue(clicks),
      listTranscript: vi.fn().mockResolvedValue([]),
      updateClickActionDescription: vi.fn(),
    };

    const analyzer = {
      analyze: vi.fn().mockRejectedValue(new AiRateLimitError("Please retry later", 46_408)),
    };

    const controller = new RecordingController(
      recordings as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      null,
      analyzer,
      { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    );

    await expect(controller.analyzeClicks("recording-1")).resolves.toEqual({
      clicks,
      analyzedCount: 0,
      failedCount: 3,
    });
    expect(analyzer.analyze).toHaveBeenCalledTimes(1);
    expect(recordings.updateClickActionDescription).not.toHaveBeenCalled();
  });

  it("sends prior click steps and narration as bounded context", async () => {
    // Future evidence is deliberate: the current click may only use preceding activity.
    const clicks = [
      click("previous-click", "Open settings menu", 1_000, "right"),
      click("current-click", null, 3_000, "left"),
      click("future-click", "Save changes", 5_000, "left"),
    ];

    const recordings = {
      listClicks: vi.fn().mockResolvedValue(clicks),
      listTranscript: vi.fn().mockResolvedValue([
        {
          id: "prior-transcript",
          recordingId: "recording-1",
          startMs: 1_500,
          endMs: 2_000,
          text: "Now choose the export format.",
        },
        {
          id: "future-transcript",
          recordingId: "recording-1",
          startMs: 4_000,
          endMs: 4_500,
          text: "This must not be included.",
        },
      ]),
      updateClickActionDescription: vi.fn(),
    };

    const analyzer = { analyze: vi.fn().mockResolvedValue("Select PDF format") };
    const controller = new RecordingController(
      recordings as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      null,
      analyzer,
      { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    );

    await controller.analyzeClicks("recording-1");

    expect(analyzer.analyze).toHaveBeenCalledWith(
      expect.objectContaining({
        button: "left",
        previousSteps: [{ button: "right", description: "Open settings menu" }],
        transcriptContext: ["Now choose the export format."],
      }),
    );
  });
});
