import type {
  ClickEvent,
  RecordingMediaTiming,
  RecordingTimeWindow,
  TimelineImportEntry,
} from "@path/shared";

/** A recording's wall-clock anchor; approximate anchors come from recordings without timing. */
export interface ResolvedMediaTiming {
  timing: RecordingMediaTiming;
  isApproximate: boolean;
}

/** A stored imported row before alignment; `occurredAtMs` is its original wall-clock time. */
export interface WallClockRow {
  id: number;
  occurredAtMs: number;
  text: string;
}

/**
 * Older recordings stored only their preparation time, which precedes media zero by the capture
 * setup latency. A click's wall-clock time minus its media offset reproduces media zero until the
 * first pause, so the earliest difference is the closest estimate. Pauses cannot be recovered.
 */
export function resolveMediaTiming(
  recording: { startedAt: string; mediaTiming: RecordingMediaTiming | null },
  clicks: Pick<ClickEvent, "createdAt" | "timestampMs">[],
): ResolvedMediaTiming {
  if (recording.mediaTiming) {
    return { timing: recording.mediaTiming, isApproximate: false };
  }

  const clickAnchors = clicks
    .map((click) => Date.parse(click.createdAt) - click.timestampMs)
    .filter(Number.isFinite);

  const startedAtMs =
    clickAnchors.length > 0 ? Math.min(...clickAnchors) : Date.parse(recording.startedAt);

  return {
    timing: { startedAt: new Date(startedAtMs).toISOString(), pauses: [] },
    isApproximate: true,
  };
}

/** The video ends after its media duration plus the wall-clock time spent paused before then. */
export function recordingTimeWindow(
  { timing, isApproximate }: ResolvedMediaTiming,
  durationMs: number,
): RecordingTimeWindow {
  const pausedMs = timing.pauses
    .filter((pause) => pause.atMs < durationMs)
    .reduce((total, pause) => total + pause.durationMs, 0);

  return {
    startedAt: timing.startedAt,
    endedAt: new Date(Date.parse(timing.startedAt) + durationMs + pausedMs).toISOString(),
    isApproximate,
  };
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
    if (mediaMs < pause.atMs + pause.durationMs) return pause.atMs;

    mediaMs -= pause.durationMs;
  }

  return mediaMs <= durationMs ? Math.round(mediaMs) : null;
}

/** Apply the import's clock offset, then keep only rows that fall inside the video. */
export function alignTimelineRows(
  rows: WallClockRow[],
  timing: RecordingMediaTiming,
  durationMs: number,
  offsetMs: number,
): { entries: TimelineImportEntry[]; outsideCount: number } {
  const entries: TimelineImportEntry[] = [];
  let outsideCount = 0;

  for (const row of rows) {
    const timestampMs = wallClockToMediaMs(timing, durationMs, row.occurredAtMs + offsetMs);

    if (timestampMs === null) {
      outsideCount += 1;
      continue;
    }

    entries.push({
      id: row.id,
      occurredAt: new Date(row.occurredAtMs).toISOString(),
      timestampMs,
      text: row.text,
    });
  }

  return { entries, outsideCount };
}
