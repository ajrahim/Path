import type { TranscriptSegment } from "@path/shared";

/** A managed audio file and its recording identity; optional duration is measured in milliseconds. */
export interface AudioFile {
  recordingId: string;
  path: string;
  mimeType: string;
  durationMs?: number;
}

/** Provider output uses recording-relative timestamps in the shared segment contract. */
export interface Transcript {
  language: string;
  segments: TranscriptSegment[];
}

/** Provider adapters own transport/native output parsing and declare where audio is processed. */
export interface TranscriptProvider {
  id: string;
  displayName: string;
  processingLocation: "local" | "cloud";
  transcribe(input: AudioFile): Promise<Transcript>;
}
