import type { CliState, CliSelection, CliToolId } from "./CliTools";
import { guideContextItemSchema, MAX_GUIDE_CONTEXT_ITEMS } from "./GuideContext";
import { z } from "zod";
import type { InstructionFlowState, SaveInstructionFlowInput } from "./InstructionFlows";

import {
  aiEfforts,
  aiProviders,
  MAX_TIMELINE_IMPORT_MAX_FILE_SIZE_MB,
  MAX_TIMELINE_IMPORT_OFFSET_MS,
  MAX_TIMELINE_IMPORT_PAGE_ROWS,
  MIN_TIMELINE_IMPORT_MAX_FILE_SIZE_MB,
  timelineImportKinds,
} from "./Contracts";
import type {
  AiModel,
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
  RecordingProject,
  RegionSelectionContext,
  StartRecordingInput,
  SetAiProviderKeyResult,
  CommittedGuideRevision,
  DesktopSettings,
  DocumentRevision,
  DocumentRevisionPage,
  GeneralSettings,
  GuideDocumentChange,
  GuideDocumentSnapshot,
  RecordingTimelineImports,
  SaveGuideDocumentResult,
  SaveGuideDraftResult,
  TimelineImport,
  TimelineImportFileResult,
  TimelineImportRowsPage,
  TimelineImportSettings,
  TranscriptSegment,
} from "./Contracts";

/** The preload and main process share these exact channel names; callers never choose a channel. */
export const IPC_CHANNELS = {
  appInfo: "app:get-info",
  appShowTrayMenu: "app:show-tray-menu",
  appShowMainWindow: "app:show-main-window",
  appSetRecorderPopoverExpanded: "app:set-recorder-popover-expanded",
  appSetTitleBarTheme: "app:set-title-bar-theme",
  appOpenSettings: "app:open-settings",
  appFlushRequested: "app:flush-requested",
  appFlushComplete: "app:flush-complete",
  appRecordingOpened: "app:recording-opened",
  appConsumeRecordingOpened: "app:consume-recording-opened",

  cliGet: "cli:get",
  cliRefresh: "cli:refresh",
  cliConnect: "cli:connect",
  cliSelect: "cli:select",
  cliSetMode: "cli:set-mode",
  cliChooseFolder: "cli:choose-folder",
  cliChanged: "cli:changed",

  settingsGet: "settings:get",
  settingsUpdateGeneral: "settings:update-general",
  settingsUpdateTimelineImports: "settings:update-timeline-imports",
  settingsChooseRecordingsDirectory: "settings:choose-recordings-directory",
  settingsOpenRecordingsDirectory: "settings:open-recordings-directory",
  settingsGetAiProviderKeyStatus: "settings:get-ai-provider-key-status",
  settingsSetAiProviderKey: "settings:set-ai-provider-key",
  settingsRemoveAiProviderKey: "settings:remove-ai-provider-key",
  settingsListAiProviderModels: "settings:list-ai-provider-models",
  settingsListLocalModels: "settings:list-local-models",
  settingsListAvailableAiModels: "settings:list-available-ai-models",
  settingsUpdateAiModelSelection: "settings:update-ai-model-selection",

  instructionFlowsGet: "instruction-flows:get",
  instructionFlowsSelect: "instruction-flows:select",
  instructionFlowsSave: "instruction-flows:save",
  instructionFlowsRemove: "instruction-flows:remove",
  instructionFlowsChanged: "instruction-flows:changed",

  guidesGenerate: "guides:generate",
  guidesUpdate: "guides:update",
  guidesExportMarkdown: "guides:export-markdown",
  guidesGetDocument: "guides:get-document",
  guidesSaveDocument: "guides:save-document",
  guidesSaveDraft: "guides:save-draft",
  guidesDiscardDraft: "guides:discard-draft",
  guidesListRevisions: "guides:list-revisions",
  guidesGetRevision: "guides:get-revision",
  guidesRestoreRevision: "guides:restore-revision",
  guidesChanged: "guides:changed",

  projectsList: "projects:list",
  projectsChange: "projects:change",

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
  recordingsListTimelineImports: "recordings:list-timeline-imports",
  recordingsListTimelineImportRows: "recordings:list-timeline-import-rows",
  recordingsLocateTimelineImportRow: "recordings:locate-timeline-import-row",
  recordingsImportTimelineFile: "recordings:import-timeline-file",
  recordingsUpdateTimelineImportOffset: "recordings:update-timeline-import-offset",
  recordingsRemoveTimelineImport: "recordings:remove-timeline-import",

  recordingListSources: "recording:list-sources",
  recordingStart: "recording:start",
  recordingStop: "recording:stop",
  recordingPause: "recording:pause",
  recordingResume: "recording:resume",
  recordingSetClickTracking: "recording:set-click-tracking",
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
export const clickTrackingInputSchema = z.boolean();

export const setAiProviderKeyInputSchema = z.strictObject({
  provider: z.enum(aiProviders),
  key: z.string().trim().min(1).max(1_000),
});

export const aiProviderInputSchema = z.strictObject({
  provider: z.enum(aiProviders),
});

export const updateGeneralSettingsInputSchema = z.strictObject({ minimizeToTray: z.boolean() });

export const updateTimelineImportSettingsInputSchema = z.strictObject({
  maxFileSizeMb: z
    .number()
    .int()
    .min(MIN_TIMELINE_IMPORT_MAX_FILE_SIZE_MB)
    .max(MAX_TIMELINE_IMPORT_MAX_FILE_SIZE_MB),
});

export const recorderPopoverExpandedInputSchema = z.strictObject({ expanded: z.boolean() });

export const titleBarThemeInputSchema = z.strictObject({
  theme: z.enum(["light", "dark"]),
  dimmed: z.boolean().optional(),
});

const SETTINGS_SECTIONS = ["general", "storage", "keys", "prompts", "cli"] as const;

export const openSettingsInputSchema = z.strictObject({
  section: z.enum(SETTINGS_SECTIONS).optional(),
});

export const aiModelSelectionSchema = z.discriminatedUnion("source", [
  z.strictObject({
    source: z.literal("local"),
    modelId: z.string().trim().min(1).max(200),
    modelName: z.string().trim().min(1).max(200),
    effort: z.enum(aiEfforts).optional(),
  }),
  z.strictObject({
    source: z.literal("api"),
    provider: z.enum(aiProviders),
    modelId: z.string().trim().min(1).max(200),
    modelName: z.string().trim().min(1).max(200),
    effort: z.enum(aiEfforts).optional(),
  }),
]);

/** The persisted settings document; the desktop validates it every time it is loaded. */
export const storedDesktopSettingsSchema = z.strictObject({
  general: updateGeneralSettingsInputSchema,
  timelineImports: updateTimelineImportSettingsInputSchema,
  recordingsDirectory: z.string().min(1).max(4_096),
  aiModelSelections: z.strictObject({
    visual: aiModelSelectionSchema,
    text: aiModelSelectionSchema,
  }),
});

export const updateAiModelSelectionInputSchema = z.strictObject({
  purpose: z.enum(["visual", "text"]),
  selection: aiModelSelectionSchema,
});

export const projectChangeInputSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("create"), name: z.string().trim().min(1).max(80) }),
  z.strictObject({
    action: z.literal("rename"),
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
  }),
  z.strictObject({ action: z.literal("remove"), id: z.string().uuid() }),
  z.strictObject({
    action: z.literal("move"),
    recordingId: z.string().uuid(),
    projectId: z.string().uuid().nullable(),
  }),
]);
export type ProjectChangeInput = z.infer<typeof projectChangeInputSchema>;

export const recordingIdInputSchema = z.strictObject({ id: z.string().uuid() });

const MAX_MARKDOWN_LENGTH = 10_000_000;
const markdownSchema = z.string().max(MAX_MARKDOWN_LENGTH);
const draftVersionSchema = z.number().int().min(0);
const revisionNumberSchema = z.number().int().min(1);

export const generateGuideInputSchema = recordingIdInputSchema.extend({
  instructions: z.string().trim().max(10_000),
  /** Unsaved editor text this generation will replace; it is checkpointed into history. */
  replacedMarkdown: markdownSchema.optional(),
});

export const updateGuideInputSchema = recordingIdInputSchema.extend({
  instructions: z.string().trim().max(10_000),
  currentMarkdown: markdownSchema,
  updatePrompt: z.string().trim().min(1).max(10_000),
  context: z.array(guideContextItemSchema).max(MAX_GUIDE_CONTEXT_ITEMS).optional(),
  contextFolder: z.string().min(1).max(4096).optional(),
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

export const timelineImportInputSchema = z.strictObject({
  recordingId: z.string().uuid(),
  kind: z.enum(timelineImportKinds),
});

const timelineImportQuerySchema = z.string().trim().min(1).max(200).optional();

export const timelineImportRowsInputSchema = timelineImportInputSchema.extend({
  start: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  limit: z.number().int().min(1).max(MAX_TIMELINE_IMPORT_PAGE_ROWS),
  query: timelineImportQuerySchema,
});

export const locateTimelineImportRowInputSchema = timelineImportInputSchema.extend({
  timestampMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  query: timelineImportQuerySchema,
});

export const timelineImportOffsetInputSchema = timelineImportInputSchema.extend({
  offsetMs: z.number().int().min(-MAX_TIMELINE_IMPORT_OFFSET_MS).max(MAX_TIMELINE_IMPORT_OFFSET_MS),
});

export const saveGuideDocumentInputSchema = recordingIdInputSchema.extend({
  markdown: markdownSchema,
  /** The saved revision this editor last loaded; a newer save elsewhere rejects this one. */
  expectedSavedRevisionNumber: revisionNumberSchema.nullable(),
  draftVersion: draftVersionSchema,
});

export const saveGuideDraftInputSchema = recordingIdInputSchema.extend({
  markdown: markdownSchema,
  expectedDraftVersion: draftVersionSchema,
});

export const discardGuideDraftInputSchema = recordingIdInputSchema.extend({
  expectedDraftVersion: draftVersionSchema,
});

export const listGuideRevisionsInputSchema = recordingIdInputSchema.extend({
  beforeNumber: revisionNumberSchema.optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export const guideRevisionInputSchema = recordingIdInputSchema.extend({
  number: revisionNumberSchema,
});

export const restoreGuideRevisionInputSchema = guideRevisionInputSchema.extend({
  /** Unsaved editor text the restore replaces; it is checkpointed into history. */
  replacedMarkdown: markdownSchema.optional(),
});

export const appFlushCompleteInputSchema = z.strictObject({
  requestId: z.number().int().min(1),
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
    setTitleBarTheme(input: z.infer<typeof titleBarThemeInputSchema>): Promise<void>;
    showMainWindow(): Promise<void>;
    setRecorderPopoverExpanded(input: { expanded: boolean }): Promise<void>;
    openSettings(input?: z.infer<typeof openSettingsInputSchema>): Promise<void>;
    /** Receives a recording opened by an application link or notification. */
    onRecordingOpened(listener: (input: { recordingId: string }) => void): () => void;
    /** Takes the latest open request, including one received before the workspace mounted. */
    consumeRecordingOpened(): Promise<{ recordingId: string } | null>;
    /**
     * Registers work that must finish before the app quits, such as a pending draft write.
     * Main waits, with a time limit, until every registered listener in the window settles.
     */
    onFlushRequested(listener: () => Promise<void>): () => void;
  };

  cli: {
    get(): Promise<CliState>;
    refresh(input?: { tool: CliToolId; model?: string }): Promise<CliState>;
    connect(input: { tool: CliToolId; connected: boolean }): Promise<CliState>;
    select(input: CliSelection): Promise<CliState>;
    setMode(input: { mode: "model" | "cli" }): Promise<CliState>;
    chooseFolder(): Promise<string | null>;
    onChanged(listener: (state: CliState) => void): () => void;
  };
  settings: {
    get(): Promise<DesktopSettings>;
    updateGeneral(input: GeneralSettings): Promise<DesktopSettings>;
    updateTimelineImports(input: TimelineImportSettings): Promise<DesktopSettings>;
    chooseRecordingsDirectory(): Promise<DesktopSettings | null>;
    openRecordingsDirectory(): Promise<void>;
    getAiProviderKeyStatus(): Promise<AiProviderKeyStatus>;
    setAiProviderKey(
      input: z.infer<typeof setAiProviderKeyInputSchema>,
    ): Promise<SetAiProviderKeyResult>;
    removeAiProviderKey(input: { provider: AiProvider }): Promise<AiProviderKeyStatus>;
    listAiProviderModels(input: { provider: AiProvider }): Promise<AiModel[]>;
    listLocalModels(): Promise<AiModel[]>;
    listAvailableAiModels(): Promise<AvailableAiModels>;
    updateAiModelSelection(
      input: z.infer<typeof updateAiModelSelectionInputSchema>,
    ): Promise<DesktopSettings>;
  };

  instructionFlows: {
    get(): Promise<InstructionFlowState>;
    select(input: { id: string }): Promise<InstructionFlowState>;
    save(input: SaveInstructionFlowInput): Promise<InstructionFlowState>;
    remove(input: { id: string }): Promise<InstructionFlowState>;
    onChanged(listener: (state: InstructionFlowState) => void): () => void;
  };

  guides: {
    generate(input: z.infer<typeof generateGuideInputSchema>): Promise<CommittedGuideRevision>;
    update(input: z.infer<typeof updateGuideInputSchema>): Promise<CommittedGuideRevision>;
    exportMarkdown(input: z.infer<typeof exportMarkdownInputSchema>): Promise<boolean>;
    getDocument(input: RecordingIdInput): Promise<GuideDocumentSnapshot>;
    saveDocument(
      input: z.infer<typeof saveGuideDocumentInputSchema>,
    ): Promise<SaveGuideDocumentResult>;
    saveDraft(input: z.infer<typeof saveGuideDraftInputSchema>): Promise<SaveGuideDraftResult>;
    discardDraft(
      input: z.infer<typeof discardGuideDraftInputSchema>,
    ): Promise<SaveGuideDraftResult>;
    listRevisions(
      input: z.infer<typeof listGuideRevisionsInputSchema>,
    ): Promise<DocumentRevisionPage>;
    getRevision(input: z.infer<typeof guideRevisionInputSchema>): Promise<DocumentRevision>;
    restoreRevision(
      input: z.infer<typeof restoreGuideRevisionInputSchema>,
    ): Promise<CommittedGuideRevision>;
    onChanged(listener: (change: GuideDocumentChange) => void): () => void;
  };

  projects: {
    list(): Promise<RecordingProject[]>;
    change(input: ProjectChangeInput): Promise<RecordingProject[]>;
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
    listTimelineImports(input: RecordingIdInput): Promise<RecordingTimelineImports>;
    listTimelineImportRows(
      input: z.infer<typeof timelineImportRowsInputSchema>,
    ): Promise<TimelineImportRowsPage>;
    /** Index of the last matching row at or before a media time, or -1. */
    locateTimelineImportRow(
      input: z.infer<typeof locateTimelineImportRowInputSchema>,
    ): Promise<{ index: number }>;
    importTimelineFile(
      input: z.infer<typeof timelineImportInputSchema>,
    ): Promise<TimelineImportFileResult>;
    updateTimelineImportOffset(
      input: z.infer<typeof timelineImportOffsetInputSchema>,
    ): Promise<TimelineImport>;
    removeTimelineImport(input: z.infer<typeof timelineImportInputSchema>): Promise<void>;
  };

  recording: {
    listSources(): Promise<CaptureSource[]>;
    start(input: StartRecordingInput): Promise<RecordingRuntimeState>;
    stop(): Promise<RecordingRuntimeState>;
    pause(): Promise<RecordingRuntimeState>;
    resume(): Promise<RecordingRuntimeState>;
    setClickTracking(enabled: boolean): Promise<RecordingRuntimeState>;
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
