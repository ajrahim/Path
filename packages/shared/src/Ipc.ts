import { z } from "zod";
import type {
  AiModel,
  AiModelSelection,
  AvailableAiModels,
  AiProvider,
  AiProviderKeyStatus,
  AppInfo,
  CaptureSource,
  CaptureWorkerStart,
  ClickEvent,
  ClickAnalysisResult,
  RecordingRuntimeState,
  RecordingSession,
  RecordingSummary,
  RegionSelectionContext,
  StartRecordingInput,
  SetAiProviderKeyResult,
  DesktopSettings,
  GeneratedGuide,
  GeneralSettings,
  PersistedGuide,
  TranscriptSegment,
} from "./Contracts";

/** The preload and main process share these exact channel names; callers never choose a channel. */
export const IPC_CHANNELS = {
  appInfo: "app:get-info",
  appShowTrayMenu: "app:show-tray-menu",
  appShowMainWindow: "app:show-main-window",
  appSetRecorderPopoverExpanded: "app:set-recorder-popover-expanded",
  appOpenSettings: "app:open-settings",

  settingsGet: "settings:get",
  settingsUpdateGeneral: "settings:update-general",
  settingsUpdateGuideInstructions: "settings:update-guide-instructions",
  settingsChooseRecordingsDirectory: "settings:choose-recordings-directory",
  settingsOpenRecordingsDirectory: "settings:open-recordings-directory",
  settingsGetAiProviderKeyStatus: "settings:get-ai-provider-key-status",
  settingsSetAiProviderKey: "settings:set-ai-provider-key",
  settingsRemoveAiProviderKey: "settings:remove-ai-provider-key",
  settingsListAiProviderModels: "settings:list-ai-provider-models",
  settingsListLocalModels: "settings:list-local-models",
  settingsUpdateLocalVisionModel: "settings:update-local-vision-model",
  settingsListAvailableAiModels: "settings:list-available-ai-models",
  settingsUpdateAiModelSelection: "settings:update-ai-model-selection",

  guidesGenerate: "guides:generate",
  guidesExportMarkdown: "guides:export-markdown",
  guidesGetDocument: "guides:get-document",
  guidesSaveDocument: "guides:save-document",

  recordingsList: "recordings:list",
  recordingsGet: "recordings:get",
  recordingsRename: "recordings:rename",
  recordingsDelete: "recordings:delete",
  recordingsMediaUrl: "recordings:media-url",
  recordingsThumbnailUrl: "recordings:thumbnail-url",
  recordingsListClicks: "recordings:list-clicks",
  recordingsAnalyzeClicks: "recordings:analyze-clicks",
  recordingsScreenshotUrl: "recordings:screenshot-url",
  recordingsRevealScreenshot: "recordings:reveal-screenshot",
  recordingsListTranscript: "recordings:list-transcript",
  recordingsUpdateTranscript: "recordings:update-transcript",
  recordingsDeleteTranscript: "recordings:delete-transcript",
  recordingsDeleteClick: "recordings:delete-click",
  recordingsUpdateClick: "recordings:update-click",
  recordingsRetryProcessing: "recordings:retry-processing",

  recordingListSources: "recording:list-sources",
  recordingStart: "recording:start",
  recordingStop: "recording:stop",
  recordingPause: "recording:pause",
  recordingResume: "recording:resume",
  recordingGetState: "recording:get-state",
  recordingStateChanged: "recording:state-changed",

  captureStartRequested: "capture:start-requested",
  captureStopRequested: "capture:stop-requested",
  capturePauseRequested: "capture:pause-requested",
  captureResumeRequested: "capture:resume-requested",
  captureReady: "capture:ready",
  captureAppendChunk: "capture:append-chunk",
  captureComplete: "capture:complete",
  captureFailed: "capture:failed",

  regionSelect: "region:select",
  regionGetContext: "region:get-context",
  regionConfirm: "region:confirm",
  regionCancel: "region:cancel",
} as const;

// Strict schemas bound renderer-controlled values before the desktop touches native services.
export const setAiProviderKeyInputSchema = z.strictObject({
  provider: z.enum(["anthropic", "openai", "google"]),
  key: z.string().trim().min(1).max(1_000),
});

export const aiProviderInputSchema = z.strictObject({
  provider: z.enum(["anthropic", "openai", "google"]),
});

export const updateGeneralSettingsInputSchema = z.strictObject({ minimizeToTray: z.boolean() });

export const recorderPopoverExpandedInputSchema = z.strictObject({ expanded: z.boolean() });

export const updateGuideInstructionsInputSchema = z.strictObject({
  guideInstructions: z.string().trim().max(10_000),
});

export const updateLocalVisionModelInputSchema = z.strictObject({
  model: z.string().trim().min(1).max(200),
});

export const aiModelSelectionSchema = z.discriminatedUnion("source", [
  z.strictObject({
    source: z.literal("local"),
    modelId: z.string().trim().min(1).max(200),
    modelName: z.string().trim().min(1).max(200),
  }),
  z.strictObject({
    source: z.literal("api"),
    provider: z.enum(["anthropic", "openai", "google"]),
    modelId: z.string().trim().min(1).max(200),
    modelName: z.string().trim().min(1).max(200),
  }),
]);

export const recordingIdInputSchema = z.strictObject({ id: z.string().uuid() });

export const generateGuideInputSchema = recordingIdInputSchema.extend({
  instructions: z.string().trim().max(10_000),
});

export const renameRecordingInputSchema = recordingIdInputSchema.extend({
  title: z.string().trim().min(1).max(120),
});

const captureRegionSchema = z.strictObject({
  displayId: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  scaleFactor: z.number().finite().positive(),
});

export const startRecordingInputSchema = z.strictObject({
  sourceId: z.string().min(1).max(512),
  title: z.string().trim().min(1).max(120),
  captureMode: z.enum(["display", "window", "region"]),
  captureRegion: captureRegionSchema.optional(),
  includeMicrophone: z.boolean(),
  captureClicks: z.boolean(),
});

export const clickAssetInputSchema = z.strictObject({
  recordingId: z.string().uuid(),
  clickId: z.string().uuid(),
});

export const activityItemInputSchema = z.strictObject({
  recordingId: z.string().uuid(),
  id: z.string().uuid(),
});

export const updateTranscriptInputSchema = activityItemInputSchema.extend({
  text: z.string().trim().min(1).max(10_000),
});

export const updateClickDescriptionInputSchema = activityItemInputSchema.extend({
  description: z.string().trim().min(1).max(2_000),
});

export const saveGuideDocumentInputSchema = recordingIdInputSchema.extend({
  markdown: z.string().max(10_000_000),
});

export const exportMarkdownInputSchema = z.strictObject({
  suggestedName: z.string().trim().min(1).max(120),
  markdown: z.string().max(10_000_000),
});

export const selectRegionInputSchema = z.strictObject({
  sourceId: z.string().min(1).max(512),
  displayId: z.string().min(1),
});

export const regionRectangleSchema = z.strictObject({
  x: z.number().finite().nonnegative(),
  y: z.number().finite().nonnegative(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});

export const captureFailureSchema = z.strictObject({ message: z.string().min(1).max(500) });

type RecordingIdInput = z.infer<typeof recordingIdInputSchema>;
type RenameRecordingInput = z.infer<typeof renameRecordingInputSchema>;

/**
 * Serializable capabilities exposed by preload. Main still validates input and sender ownership.
 * Event methods return a disposer that the subscribing renderer must call during cleanup.
 */
export interface DesktopApi {
  app: {
    getInfo(): Promise<AppInfo>;
    showTrayMenu(): Promise<void>;
    showMainWindow(): Promise<void>;
    setRecorderPopoverExpanded(input: { expanded: boolean }): Promise<void>;
    openSettings(): Promise<void>;
  };

  settings: {
    get(): Promise<DesktopSettings>;
    updateGeneral(input: GeneralSettings): Promise<DesktopSettings>;
    updateGuideInstructions(input: { guideInstructions: string }): Promise<DesktopSettings>;
    chooseRecordingsDirectory(): Promise<DesktopSettings | null>;
    openRecordingsDirectory(): Promise<void>;
    getAiProviderKeyStatus(): Promise<AiProviderKeyStatus>;
    setAiProviderKey(
      input: z.infer<typeof setAiProviderKeyInputSchema>,
    ): Promise<SetAiProviderKeyResult>;
    removeAiProviderKey(input: { provider: AiProvider }): Promise<AiProviderKeyStatus>;
    listAiProviderModels(input: { provider: AiProvider }): Promise<AiModel[]>;
    listLocalModels(): Promise<AiModel[]>;
    updateLocalVisionModel(input: { model: string }): Promise<DesktopSettings>;
    listAvailableAiModels(): Promise<AvailableAiModels>;
    updateAiModelSelection(input: AiModelSelection): Promise<DesktopSettings>;
  };

  guides: {
    generate(input: z.infer<typeof generateGuideInputSchema>): Promise<GeneratedGuide>;
    exportMarkdown(input: z.infer<typeof exportMarkdownInputSchema>): Promise<boolean>;
    getDocument(input: RecordingIdInput): Promise<PersistedGuide | null>;
    saveDocument(input: z.infer<typeof saveGuideDocumentInputSchema>): Promise<PersistedGuide>;
  };

  recordings: {
    list(): Promise<RecordingSummary[]>;
    get(input: RecordingIdInput): Promise<RecordingSession | null>;
    rename(input: RenameRecordingInput): Promise<RecordingSummary>;
    delete(input: RecordingIdInput): Promise<void>;
    mediaUrl(input: RecordingIdInput): Promise<string>;
    thumbnailUrl(input: RecordingIdInput): Promise<string | null>;
    listClicks(input: RecordingIdInput): Promise<ClickEvent[]>;
    analyzeClicks(input: RecordingIdInput): Promise<ClickAnalysisResult>;
    screenshotUrl(input: z.infer<typeof clickAssetInputSchema>): Promise<string>;
    revealScreenshot(input: z.infer<typeof clickAssetInputSchema>): Promise<void>;
    listTranscript(input: RecordingIdInput): Promise<TranscriptSegment[]>;
    updateTranscript(
      input: z.infer<typeof updateTranscriptInputSchema>,
    ): Promise<TranscriptSegment>;
    deleteTranscript(input: z.infer<typeof activityItemInputSchema>): Promise<void>;
    deleteClick(input: z.infer<typeof activityItemInputSchema>): Promise<void>;
    updateClick(input: z.infer<typeof updateClickDescriptionInputSchema>): Promise<ClickEvent>;
    retryProcessing(input: RecordingIdInput): Promise<void>;
  };

  recording: {
    listSources(): Promise<CaptureSource[]>;
    start(input: StartRecordingInput): Promise<RecordingRuntimeState>;
    stop(): Promise<RecordingRuntimeState>;
    pause(): Promise<RecordingRuntimeState>;
    resume(): Promise<RecordingRuntimeState>;
    getState(): Promise<RecordingRuntimeState>;
    selectRegion(
      input: z.infer<typeof selectRegionInputSchema>,
    ): Promise<StartRecordingInput["captureRegion"] | null>;
    onStateChanged(listener: (state: RecordingRuntimeState) => void): () => void;
  };

  // Only the capture worker may send media chunks or complete the active recording.
  capture: {
    ready(): Promise<void>;
    appendChunk(chunk: Uint8Array): Promise<void>;
    complete(): Promise<void>;
    fail(message: string): Promise<void>;
    onStartRequested(listener: (input: CaptureWorkerStart) => void): () => void;
    onStopRequested(listener: () => void): () => void;
    onPauseRequested(listener: () => void): () => void;
    onResumeRequested(listener: () => void): () => void;
  };

  // Selection coordinates are relative to the selector window until main resolves its display origin.
  region: {
    getContext(): Promise<RegionSelectionContext>;
    confirm(rectangle: z.infer<typeof regionRectangleSchema>): Promise<void>;
    cancel(): Promise<void>;
  };
}
