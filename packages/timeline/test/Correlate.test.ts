import { describe, expect, it } from "vitest";
import type { ClickEvent, TranscriptSegment } from "@path/shared";
import { activityKey, mergeTimeline } from "../src";

function click(id: string, timestampMs: number): ClickEvent {
  return {
    id,
    recordingId: "recording-1",
    timestampMs,
    button: "left",
    globalX: 0,
    globalY: 0,
    displayId: "display-1",
    displayX: 0,
    displayY: 0,
    captureX: 0,
    captureY: 0,
    videoX: 0,
    videoY: 0,
    normalizedX: 0.5,
    normalizedY: 0.5,
    recordingFrameWidth: 1920,
    recordingFrameHeight: 1080,
    insideCaptureRegion: true,
    screenshotPath: `screenshots/${id}.png`,
    actionDescription: null,
    createdAt: "2026-08-23T10:00:00.000Z",
  };
}

describe("mergeTimeline", () => {
  it("orders shuffled activity and puts dialogue before clicks at the same timestamp", () => {
    const transcript: TranscriptSegment[] = [
      {
        id: "later",
        recordingId: "recording-1",
        startMs: 8_000,
        endMs: 9_000,
        text: "Save the changes.",
      },
      {
        id: "earlier",
        recordingId: "recording-1",
        startMs: 2_000,
        endMs: 3_000,
        text: "Open settings.",
      },
    ];

    const clicks = [click("last", 10_000), click("tie", 2_000), click("first", 500)];

    expect(
      mergeTimeline(transcript, clicks).map((entry) => `${entry.type}:${entry.timestampMs}`),
    ).toEqual(["click:500", "transcript:2000", "click:2000", "transcript:8000", "click:10000"]);

    // Sorting the merged view must not reorder the source arrays owned by other consumers.
    expect(transcript.map((segment) => segment.id)).toEqual(["later", "earlier"]);
    expect(clicks.map((event) => event.id)).toEqual(["last", "tie", "first"]);
  });

  it("merges transcript segments and clicks in timestamp order", () => {
    const transcript: TranscriptSegment[] = [
      {
        id: "s1",
        recordingId: "recording-1",
        startMs: 0,
        endMs: 4_900,
        text: "First open settings.",
      },
      {
        id: "s2",
        recordingId: "recording-1",
        startMs: 7_000,
        endMs: 8_600,
        text: "Now click integrations.",
      },
    ];

    const entries = mergeTimeline(transcript, [click("click-1", 5_200), click("click-2", 8_730)]);

    expect(entries.map((entry) => `${entry.type}:${entry.timestampMs}`)).toEqual([
      "transcript:0",
      "click:5200",
      "transcript:7000",
      "click:8730",
    ]);
    expect(entries.map(activityKey)).toEqual([
      "transcript-s1",
      "click-click-1",
      "transcript-s2",
      "click-click-2",
    ]);
  });
});
