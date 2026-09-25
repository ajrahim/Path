import type { RecordingMediaTiming, RecordingTimeWindow, TimelineImportEntry } from "@path/shared";

/** A stored imported row before alignment; `occurredAtMs` is its original wall-clock time. */
export interface WallClockRow {
  id: number;
  occurredAtMs: number;
  text: string;
}

/** Inclusive wall-clock bounds of the rows that align inside a video, before any offset. */
export interface WallClockRange {
  startMs: number;
  endMs: number;
}

/**
 * Pauses at or before the video's end extend its real-world interval; rows taken during such a
 * pause map to the pause point, where playback resumes.
 */
function pausedMsThrough(timing: RecordingMediaTiming, mediaMs: number): number {
  return timing.pauses
    .filter((pause) => pause.atMs <= mediaMs)
    .reduce((total, pause) => total + pause.durationMs, 0);
}

/** The video ends after its media duration plus the wall-clock time spent paused before then. */
export function recordingTimeWindow(
  timing: RecordingMediaTiming,
  durationMs: number,
): RecordingTimeWindow {
  const range = alignedWallClockRange(timing, durationMs);

  return {
    startedAt: timing.startedAt,
    endedAt: new Date(range.endMs).toISOString(),
  };
}

/**
 * Wall-clock times that map inside the video form one contiguous interval, so storage can select
 * a video's rows with an indexed range. `wallClockToMediaMs` is non-null exactly inside it.
 */
export function alignedWallClockRange(
  timing: RecordingMediaTiming,
  durationMs: number,
): WallClockRange {
  const startMs = Date.parse(timing.startedAt);

  return { startMs, endMs: startMs + durationMs + pausedMsThrough(timing, durationMs) };
}

/** The latest wall-clock time whose row appears at or before a media position. */
export function latestWallClockAtMediaMs(timing: RecordingMediaTiming, mediaMs: number): number {
  return Date.parse(timing.startedAt) + mediaMs + pausedMsThrough(timing, mediaMs);
}

/**
 * Convert a wall-clock time to a media offset, or null outside the video. Pauses must be in
 * chronological order; time spent inside a pause maps to the pause point, where playback resumes.
 */
export function wallClockToMediaMs(
  timing: RecordingMediaTiming,
  durationMs: number,
  wallClockMs: number,
): number | null {
  let mediaMs = wallClockMs - Date.parse(timing.startedAt);

  if (mediaMs < 0) return null;

  for (const pause of timing.pauses) {
    if (mediaMs <= pause.atMs) break;

    if (mediaMs < pause.atMs + pause.durationMs) {
      mediaMs = pause.atMs;
      break;
    }

    mediaMs -= pause.durationMs;
  }

  return mediaMs <= durationMs ? Math.round(mediaMs) : null;
}

/** Apply the import's clock offset to one row; rows outside the video have no media time. */
export function alignTimelineRow(
  row: WallClockRow,
  timing: RecordingMediaTiming,
  durationMs: number,
  offsetMs: number,
): TimelineImportEntry | null {
  const timestampMs = wallClockToMediaMs(timing, durationMs, row.occurredAtMs + offsetMs);

  if (timestampMs === null) return null;

  return {
    id: row.id,
    occurredAt: new Date(row.occurredAtMs).toISOString(),
    timestampMs,
    text: row.text,
  };
}
