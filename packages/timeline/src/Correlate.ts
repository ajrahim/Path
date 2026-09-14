import type { ClickEvent, TranscriptSegment } from "@path/shared";

/** A review entry retains the original evidence and its media-relative offset in milliseconds. */
export type OrderedTimelineEntry =
  | { type: "transcript"; timestampMs: number; segment: TranscriptSegment }
  | { type: "click"; timestampMs: number; click: ClickEvent };

/** Merge without mutating either input; dialogue precedes a click at an identical timestamp. */
export function mergeTimeline(
  transcript: TranscriptSegment[],
  clicks: ClickEvent[],
): OrderedTimelineEntry[] {
  return [
    ...transcript.map((segment): OrderedTimelineEntry => ({
      type: "transcript",
      timestampMs: segment.startMs,
      segment,
    })),
    ...clicks.map((click): OrderedTimelineEntry => ({
      type: "click",
      timestampMs: click.timestampMs,
      click,
    })),
  ].sort((left, right) => {
    const timeDifference = left.timestampMs - right.timestampMs;

    if (timeDifference !== 0) return timeDifference;
    if (left.type === right.type) return 0;

    return left.type === "transcript" ? -1 : 1;
  });
}
