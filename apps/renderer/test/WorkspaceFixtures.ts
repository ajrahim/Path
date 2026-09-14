import type { ClickEvent, TranscriptSegment } from "@path/shared";

// Reuse item IDs across recordings to catch updates that forget to check the owning recording.
export function transcriptSegment(recordingId: string, id = "dialogue-1"): TranscriptSegment {
  return { id, recordingId, startMs: 100, endMs: 500, text: "Open the menu." };
}

export function capturedClick(recordingId: string, id = "click-1"): ClickEvent {
  return {
    id,
    recordingId,
    timestampMs: 300,
    button: "left",
    globalX: 20,
    globalY: 30,
    displayId: "display-1",
    displayX: 20,
    displayY: 30,
    captureX: 20,
    captureY: 30,
    videoX: 20,
    videoY: 30,
    normalizedX: 0.2,
    normalizedY: 0.3,
    recordingFrameWidth: 100,
    recordingFrameHeight: 100,
    insideCaptureRegion: true,
    screenshotPath: "click.webp",
    actionDescription: null,
    createdAt: "2026-09-14T12:00:00.000Z",
  };
}
