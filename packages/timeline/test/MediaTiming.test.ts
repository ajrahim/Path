import { describe, expect, it } from "vitest";
import type { RecordingMediaTiming } from "@path/shared";
import {
  alignTimelineRows,
  recordingTimeWindow,
  resolveMediaTiming,
  wallClockToMediaMs,
} from "../src/MediaTiming";

const startedAt = "2026-09-14T10:00:00.000Z";
const startMs = Date.parse(startedAt);

// Paused for 5 s at 10 s of media, so wall 10:00:15 is media 10 s.
const pausedTiming: RecordingMediaTiming = {
  startedAt,
  pauses: [{ atMs: 10_000, durationMs: 5_000 }],
};

describe("wall-clock to media time", () => {
  it("maps times before a pause directly and removes paused time afterwards", () => {
    expect(wallClockToMediaMs(pausedTiming, 30_000, startMs + 4_000)).toBe(4_000);
    expect(wallClockToMediaMs(pausedTiming, 30_000, startMs + 10_000)).toBe(10_000);
    expect(wallClockToMediaMs(pausedTiming, 30_000, startMs + 20_000)).toBe(15_000);
  });

  it("maps wall time inside a pause to the pause point", () => {
    expect(wallClockToMediaMs(pausedTiming, 30_000, startMs + 12_500)).toBe(10_000);
  });

  it("returns null before media zero and after the video ends", () => {
    expect(wallClockToMediaMs(pausedTiming, 30_000, startMs - 1)).toBeNull();
    expect(wallClockToMediaMs(pausedTiming, 30_000, startMs + 35_000)).toBe(30_000);
    expect(wallClockToMediaMs(pausedTiming, 30_000, startMs + 35_001)).toBeNull();
  });
});

describe("recording time window", () => {
  it("ends after the media duration plus pauses taken before the end", () => {
    const window = recordingTimeWindow({ timing: pausedTiming, isApproximate: false }, 30_000);

    expect(window).toEqual({
      startedAt,
      endedAt: "2026-09-14T10:00:35.000Z",
      isApproximate: false,
    });
  });
});

describe("media timing resolution", () => {
  it("uses stored timing exactly", () => {
    const resolved = resolveMediaTiming(
      { startedAt: "2026-09-14T09:59:58.000Z", mediaTiming: pausedTiming },
      [],
    );

    expect(resolved).toEqual({ timing: pausedTiming, isApproximate: false });
  });

  it("estimates older recordings from the earliest click anchor", () => {
    const resolved = resolveMediaTiming(
      { startedAt: "2026-09-14T09:59:58.000Z", mediaTiming: null },
      [
        { createdAt: "2026-09-14T10:00:12.000Z", timestampMs: 2_000 },
        { createdAt: "2026-09-14T10:00:03.500Z", timestampMs: 3_000 },
      ],
    );

    expect(resolved).toEqual({
      timing: { startedAt: "2026-09-14T10:00:00.500Z", pauses: [] },
      isApproximate: true,
    });
  });

  it("falls back to the recording start without clicks", () => {
    const resolved = resolveMediaTiming({ startedAt, mediaTiming: null }, []);

    expect(resolved).toEqual({ timing: { startedAt, pauses: [] }, isApproximate: true });
  });
});

describe("row alignment", () => {
  const rows = [
    { id: 1, occurredAtMs: startMs - 2_000, text: "before" },
    { id: 2, occurredAtMs: startMs + 1_000, text: "inside" },
    { id: 3, occurredAtMs: startMs + 40_000, text: "after" },
  ];

  it("keeps rows inside the video and counts the rest", () => {
    const result = alignTimelineRows(rows, pausedTiming, 30_000, 0);

    expect(result.outsideCount).toBe(2);
    expect(result.entries).toEqual([
      {
        id: 2,
        occurredAt: new Date(startMs + 1_000).toISOString(),
        timestampMs: 1_000,
        text: "inside",
      },
    ]);
  });

  it("applies the offset before alignment while preserving the original time", () => {
    const result = alignTimelineRows(rows, pausedTiming, 30_000, 3_000);

    expect(result.entries.map((entry) => [entry.id, entry.timestampMs])).toEqual([
      [1, 1_000],
      [2, 4_000],
    ]);
    expect(result.entries[0]?.occurredAt).toBe(new Date(startMs - 2_000).toISOString());
    expect(result.outsideCount).toBe(1);
  });
});
