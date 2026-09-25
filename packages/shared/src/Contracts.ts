export type CaptureMode = "display" | "window" | "region";

export type RecordingStatus = "recording" | "processing" | "ready" | "failed";

export type TranscriptStatus = "pending" | "processing" | "ready" | "failed";

export type MouseButton = "left" | "right" | "middle";

export const aiProviders = ["anthropic", "openai", "google", "openrouter"] as const;

export type AiProvider = (typeof aiProviders)[number];
export type AiProviderKeyStatus = Record<AiProvider, boolean>;

export interface AiModel {
  id: string;
  name: string;
}

export type AiModelPurpose = "visual" | "text";

export const aiEfforts = ["low", "medium", "high"] as const;

/** Reasoning effort for thinking-capable text models; unset means the provider default. */
export type AiEffort = (typeof aiEfforts)[number];

/**
 * Installed Ollama model with discovery metadata. Nulls mean the daemon
 * answered but omitted the field; a down daemon yields no models at all.
 */
export interface LocalAiModel extends AiModel {
  supportedPurposes: AiModelPurpose[];
  supportsEffort: boolean;
  sizeBytes: number | null;
  modifiedAt: string | null;
  isLoaded: boolean;
}

/** Per-1M-token USD pricing as published by the catalog source. */
export interface ApiModelPricing {
  promptPerMillion: number;
  completionPerMillion: number;
}

export interface ApiAiModel extends AiModel {
  supportedPurposes: AiModelPurpose[];
  supportsEffort: boolean;
  provider: AiProvider;
  vendor: string | null;
  contextLength: number | null;
  pricing: ApiModelPricing | null;
  isFree: boolean;
}

/** Explicit processing choice; an unavailable model must not trigger a provider fallback. */
export type AiModelSelection =
  | { source: "local"; modelId: string; modelName: string; effort?: AiEffort }
  | {
      source: "api";
      provider: AiProvider;
      modelId: string;
      modelName: string;
      effort?: AiEffort;
    };

/**
 * Reasoning-capable API families by model id. Direct catalogs omit capability
 * metadata, so OpenAI reasoning and Gemini thinking models are matched by name.
 * Anthropic and OpenRouter stay unsupported until their effort transports land.
 */
export function apiModelSupportsEffort(provider: AiProvider, modelId: string): boolean {
  if (provider === "openai") return /^(?:o\d|gpt-5)/.test(modelId);

  if (provider === "google") return /^gemini-(?:2\.5|[3-9])/.test(modelId);

  return false;
}

/** Known Ollama thinking families by model name, used with the daemon's capability probe. */
export function localModelSupportsEffort(modelName: string): boolean {
  return /(?:deepseek-r1|qwen3|gpt-oss|thinking)/i.test(modelName);
}

export type AiModelSelections = Record<AiModelPurpose, AiModelSelection>;

export interface AvailableAiModels {
  api: ApiAiModel[];
  local: LocalAiModel[];
  ollama: { status: "running" | "unavailable"; endpoint: string };
}

export interface SetAiProviderKeyResult {
  keyStatus: AiProviderKeyStatus;
  models: AiModel[];
}

export interface GeneralSettings {
  minimizeToTray: boolean;
}

export const DEFAULT_TIMELINE_IMPORT_MAX_FILE_SIZE_MB = 10;
export const MIN_TIMELINE_IMPORT_MAX_FILE_SIZE_MB = 1;
export const MAX_TIMELINE_IMPORT_MAX_FILE_SIZE_MB = 100;

export interface TimelineImportSettings {
  maxFileSizeMb: number;
}

/** Main-process settings; provider key presence is exposed separately from stored secrets. */
export interface DesktopSettings {
  general: GeneralSettings;
  timelineImports: TimelineImportSettings;
  recordingsDirectory: string;
  aiModelSelections: AiModelSelections;
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

/**
 * Stop controls stay disarmed below this media-relative age so an accidental
 * early stop cannot discard a capture; the desktop ignores earlier requests too.
 */
export const MINIMUM_RECORDING_DURATION_MS = 2_000;

/** Preparing, capturing, paused, and transitional states all own an unfinished session. */
export function isActiveRecordingStatus(status: RecordingRuntimeStatus): boolean {
  return (
    status === "preparing" ||
    status === "recording" ||
    status === "paused" ||
    status === "stopping" ||
    status === "processing"
  );
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

/** Media offset where capture paused and how long it stayed paused, in milliseconds. */
export interface MediaPause {
  atMs: number;
  durationMs: number;
}

/** Wall-clock time of media zero plus pauses; together they map real-world time to video time. */
export interface RecordingMediaTiming {
  startedAt: string;
  pauses: MediaPause[];
}

/** Managed paths may refer to an earlier recording root after the user changes storage settings. */
export interface RecordingSession extends RecordingSummary {
  captureRegion: CaptureRegion | null;
  videoPath: string | null;
  audioPath: string | null;
  /** Null until capture stops; imported evidence cannot be aligned before then. */
  mediaTiming: RecordingMediaTiming | null;
}

export const timelineImportKinds = ["log", "element"] as const;

/** A day in either direction covers time-zone and clock-skew corrections for imported files. */
export const MAX_TIMELINE_IMPORT_OFFSET_MS = 86_400_000;

/** Evidence captured outside Path: application log rows or tracked UI element paths. */
export type TimelineImportKind = (typeof timelineImportKinds)[number];

/** Real-world interval covered by the video. */
export interface RecordingTimeWindow {
  startedAt: string;
  endedAt: string;
}

/** An imported row with its original wall-clock time and its aligned media offset. */
export interface TimelineImportEntry {
  id: number;
  occurredAt: string;
  timestampMs: number;
  text: string;
}

/**
 * One imported file per kind. Rows are read in pages; `entryCount` rows fall inside the video
 * after the offset and `outsideCount` are stored but currently outside it.
 */
export interface TimelineImport {
  kind: TimelineImportKind;
  fileName: string;
  offsetMs: number;
  importedAt: string;
  rowCount: number;
  entryCount: number;
  outsideCount: number;
  unreadableLineCount: number;
}

/** Upper bound for one page of imported rows sent to a renderer. */
export const MAX_TIMELINE_IMPORT_PAGE_ROWS = 500;

/** Rows `start` onward of the rows inside the video that match an optional search query. */
export interface TimelineImportRowsPage {
  start: number;
  total: number;
  entries: TimelineImportEntry[];
}

/** A null window means the recording has no media duration to align against yet. */
export interface RecordingTimelineImports {
  window: RecordingTimeWindow | null;
  log: TimelineImport | null;
  element: TimelineImport | null;
}

export type TimelineImportFileResult =
  | { status: "imported"; timelineImport: TimelineImport }
  | { status: "canceled" }
  | { status: "too-large"; maxFileSizeMb: number }
  | { status: "no-rows" };

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

/**
 * Why a revision exists: an AI generation or update, unsaved text checkpointed before it was
 * replaced, an explicit save, or a restored earlier revision.
 */
export type DocumentRevisionKind = "generated" | "ai-update" | "checkpoint" | "saved" | "restored";

/** Metadata for one durable, append-only document revision; its Markdown is read separately. */
export interface DocumentRevisionSummary {
  number: number;
  kind: DocumentRevisionKind;
  createdAt: string;
  characterCount: number;
  restoredFromNumber: number | null;
}

export interface DocumentRevision extends DocumentRevisionSummary {
  markdown: string;
}

/** Newest-first revisions; `hasMore` means older revisions remain. */
export interface DocumentRevisionPage {
  revisions: DocumentRevisionSummary[];
  hasMore: boolean;
}

/**
 * The durable state an editor opens with. The saved revision is the last explicit save; a draft
 * holds unsaved text that survives restarts and exists only while it differs from the save.
 */
export interface GuideDocumentSnapshot {
  recordingId: string;
  saved: { revisionNumber: number; markdown: string; savedAt: string } | null;
  draft: { markdown: string; updatedAt: string } | null;
  draftVersion: number;
  latestRevisionNumber: number | null;
}

/** A draft write is rejected when another editor changed the draft after this one last saw it. */
export type SaveGuideDraftResult =
  | { status: "stored"; draftVersion: number; hasDraft: boolean }
  | { status: "conflict"; draftVersion: number };

/** A save is acknowledged only after its transaction commits; stale saves are rejected. */
export type SaveGuideDocumentResult =
  | {
      status: "saved";
      revision: DocumentRevisionSummary;
      savedAt: string;
      draftVersion: number;
    }
  | { status: "conflict"; savedRevisionNumber: number | null };

/** Generated, updated, and restored Markdown is committed to history before it is returned. */
export interface CommittedGuideRevision {
  markdown: string;
  revision: DocumentRevisionSummary;
}

/** Broadcast after a committed document change so every window can refresh its view. */
export interface GuideDocumentChange {
  recordingId: string;
  draftVersion: number;
  savedRevisionNumber: number | null;
  latestRevisionNumber: number | null;
}

export interface AppInfo {
  version: string;
  platform: "darwin" | "win32" | "linux" | "other";
  dataDirectory: string;
}

/** A local recording collection; deleting it never deletes its recordings. */
export interface RecordingProject {
  id: string;
  name: string;
  recordingIds: string[];
}
