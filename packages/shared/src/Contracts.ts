export type CaptureMode = "display" | "window" | "region";

export type RecordingStatus = "recording" | "processing" | "ready" | "failed";

export type TranscriptStatus = "pending" | "processing" | "ready" | "failed";

export type GuideStatus = "none" | "generating" | "ready" | "failed";

export type MouseButton = "left" | "right" | "middle";

export type GuideFormat =
  "help-guide" | "knowledge-base" | "tutorial" | "internal-sop" | "blog-post";

export const aiProviders = ["anthropic", "openai", "google"] as const;

export type AiProvider = (typeof aiProviders)[number];
export type AiProviderKeyStatus = Record<AiProvider, boolean>;

export interface AiModel {
  id: string;
  name: string;
}

/** Explicit processing choice; an unavailable model must not trigger a provider fallback. */
export type AiModelSelection =
  | { source: "local"; modelId: string; modelName: string }
  | { source: "api"; provider: AiProvider; modelId: string; modelName: string };

export interface AvailableAiModels {
  api: Array<AiModel & { provider: AiProvider }>;
  local: AiModel[];
}

export interface SetAiProviderKeyResult {
  keyStatus: AiProviderKeyStatus;
  models: AiModel[];
}

export interface GeneralSettings {
  minimizeToTray: boolean;
}

/** Main-process settings; provider key presence is exposed separately from stored secrets. */
export interface DesktopSettings {
  general: GeneralSettings;
  recordingsDirectory: string;
  /** @deprecated Generation uses the workspace instruction flows; retained for stored settings. */
  guideInstructions: string;
  localVisionModel: string;
  aiModelSelection: AiModelSelection;
}

/** A rectangle in global Electron DIP coordinates, including negative monitor origins. */
export interface CaptureRegion {
  displayId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
}

/** Source discovery snapshot; window sources may not have usable display geometry. */
export interface CaptureSource {
  id: string;
  name: string;
  type: "screen" | "window";
  thumbnailDataUrl: string;
  displayId: string | null;
  displayBounds: { x: number; y: number; width: number; height: number } | null;
  scaleFactor: number | null;
}

export interface StartRecordingInput {
  sourceId: string;
  title: string;
  captureMode: CaptureMode;
  captureRegion?: CaptureRegion;
  includeMicrophone: boolean;
  captureClicks: boolean;
}

/** Main assigns session identity before sending capture instructions to the sandboxed worker. */
export interface CaptureWorkerStart extends StartRecordingInput {
  recordingId: string;
  displayBounds: CaptureSource["displayBounds"];
}

export type RecordingRuntimeStatus =
  "idle" | "preparing" | "recording" | "paused" | "stopping" | "processing" | "ready" | "failed";

/** Live main-process state. Elapsed time uses the session clock, not wall-clock dates. */
export interface RecordingRuntimeState {
  status: RecordingRuntimeStatus;
  recordingId: string | null;
  elapsedMs: number;
  captureClicks: boolean;
  error: string | null;
}

export interface RegionSelectionContext {
  displayId: string;
  width: number;
  height: number;
  scaleFactor: number;
}

/** Persisted history metadata; date strings and media-relative millisecond offsets are distinct. */
export interface RecordingSummary {
  id: string;
  title: string;
  status: RecordingStatus;
  captureMode: CaptureMode;
  durationMs: number | null;
  thumbnailPath: string | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  transcriptStatus: TranscriptStatus;
}

/** Managed paths may refer to an earlier recording root after the user changes storage settings. */
export interface RecordingSession extends RecordingSummary {
  captureRegion: CaptureRegion | null;
  videoPath: string | null;
  audioPath: string | null;
  guideStatus: GuideStatus;
}

/** Editable dialogue with start/end offsets in milliseconds from the recording's media origin. */
export interface TranscriptSegment {
  id: string;
  recordingId: string;
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string;
  confidence?: number;
}

/** Keep every coordinate space so a stored click can be mapped without guessing display scale. */
export interface ClickEvent {
  id: string;
  recordingId: string;
  timestampMs: number;
  button: MouseButton;

  globalX: number;
  globalY: number;
  displayId: string;
  displayX: number;
  displayY: number;

  // Null coordinates mean mapping was unavailable or the click was outside the capture region.
  captureX: number | null;
  captureY: number | null;
  videoX: number | null;
  videoY: number | null;
  normalizedX: number | null;
  normalizedY: number | null;

  recordingFrameWidth: number | null;
  recordingFrameHeight: number | null;
  insideCaptureRegion: boolean;

  screenshotPath: string | null;
  actionDescription: string | null;
  createdAt: string;
}

export interface ClickAnalysisResult {
  clicks: ClickEvent[];
  analyzedCount: number;
  failedCount: number;
}

export interface GeneratedGuide {
  title: string;
  markdown: string;
}

/** One durable Markdown document per recording; the editor draft syncs to this row on save. */
export interface PersistedGuide {
  recordingId: string;
  title: string;
  markdown: string;
  updatedAt: string;
}

export interface AppInfo {
  version: string;
  platform: "darwin" | "win32" | "linux" | "other";
  dataDirectory: string;
}
