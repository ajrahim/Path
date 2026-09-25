import { describe, expect, it } from "vitest";
import type { RecordingMediaTiming } from "@path/shared";
import {
  alignedWallClockRange,
  alignTimelineRow,
  latestWallClockAtMediaMs,
  recordingTimeWindow,
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

  it("keeps a pause taken at the end of the video inside it", () => {
    const endPause: RecordingMediaTiming = {
      startedAt,
      pauses: [{ atMs: 30_000, durationMs: 4_000 }],
    };

    expect(wallClockToMediaMs(endPause, 30_000, startMs + 32_000)).toBe(30_000);
    expect(wallClockToMediaMs(endPause, 30_000, startMs + 34_000)).toBe(30_000);
    expect(wallClockToMediaMs(endPause, 30_000, startMs + 34_001)).toBeNull();
  });
});

describe("recording time window", () => {
  it("ends after the media duration plus pauses taken before the end", () => {
    expect(recordingTimeWindow(pausedTiming, 30_000)).toEqual({
      startedAt,
      endedAt: "2026-09-14T10:00:35.000Z",
    });
  });
});

describe("indexed alignment ranges", () => {
  const timings: RecordingMediaTiming[] = [
    { startedAt, pauses: [] },
    pausedTiming,
    {
      startedAt,
      pauses: [
        { atMs: 0, durationMs: 1_500 },
        { atMs: 7_000, durationMs: 2_000 },
        { atMs: 12_000, durationMs: 250 },
        { atMs: 20_000, durationMs: 3_000 },
      ],
    },
  ];

  it("selects exactly the wall-clock times that align inside the video", () => {
    for (const timing of timings) {
      const range = alignedWallClockRange(timing, 20_000);

      for (let wallMs = startMs - 2_000; wallMs <= startMs + 32_000; wallMs += 125) {
        const isInside = wallClockToMediaMs(timing, 20_000, wallMs) !== null;

        expect(isInside).toBe(wallMs >= range.startMs && wallMs <= range.endMs);
      }
    }
  });

  it("finds the latest wall-clock time shown at or before each media position", () => {
    for (const timing of timings) {
      for (let mediaMs = 0; mediaMs <= 20_000; mediaMs += 250) {
        const latest = latestWallClockAtMediaMs(timing, mediaMs);

        expect(wallClockToMediaMs(timing, 20_000, latest)).toBeLessThanOrEqual(mediaMs);
        expect(wallClockToMediaMs(timing, 20_000, latest + 1) ?? Infinity).toBeGreaterThan(mediaMs);
      }
    }
  });
});

describe("row alignment", () => {
  it("maps a row inside the video and rejects rows outside it", () => {
    const inside = { id: 2, occurredAtMs: startMs + 1_000, text: "inside" };

    expect(alignTimelineRow(inside, pausedTiming, 30_000, 0)).toEqual({
      id: 2,
      occurredAt: new Date(startMs + 1_000).toISOString(),
      timestampMs: 1_000,
      text: "inside",
    });
    expect(
      alignTimelineRow(
        { id: 3, occurredAtMs: startMs + 40_000, text: "after" },
        pausedTiming,
        30_000,
        0,
      ),
    ).toBeNull();
  });

  it("applies the offset before alignment while preserving the original time", () => {
    const before = { id: 1, occurredAtMs: startMs - 2_000, text: "before" };
    const entry = alignTimelineRow(before, pausedTiming, 30_000, 3_000);

    expect(entry?.timestampMs).toBe(1_000);
    expect(entry?.occurredAt).toBe(new Date(startMs - 2_000).toISOString());
  });
});
