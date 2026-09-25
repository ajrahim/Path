import type { CliToolService } from "../ai/CliToolService";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { stat, writeFile } from "node:fs/promises";
import {
  cliConnectSchema,
  cliSelectionSchema,
  cliModeSchema,
  cliModelsInputSchema,
  clickAssetInputSchema,
  clickTrackingInputSchema,
  projectChangeInputSchema,
  exportMarkdownInputSchema,
  generateGuideInputSchema,
  saveGuideDocumentInputSchema,
  saveGuideDraftInputSchema,
  discardGuideDraftInputSchema,
  listGuideRevisionsInputSchema,
  guideRevisionInputSchema,
  restoreGuideRevisionInputSchema,
  appFlushCompleteInputSchema,
  timelineImportRowsInputSchema,
  locateTimelineImportRowInputSchema,
  updateClickDescriptionInputSchema,
  aiProviderInputSchema,
  activityItemInputSchema,
  IPC_CHANNELS,
  isActiveRecordingStatus,
  instructionFlowIdInputSchema,
  saveInstructionFlowInputSchema,
  openSettingsInputSchema,
  recorderPopoverExpandedInputSchema,
  titleBarThemeInputSchema,
  recordingIdInputSchema,
  renameRecordingInputSchema,
  startRecordingInputSchema,
  captureFailureSchema,
  regionRectangleSchema,
  selectRegionInputSchema,
  setAiProviderKeyInputSchema,
  timelineImportInputSchema,
  timelineImportOffsetInputSchema,
  updateTranscriptInputSchema,
  updateGeneralSettingsInputSchema,
  updateTimelineImportSettingsInputSchema,
  updateGuideInputSchema,
  updateAiModelSelectionInputSchema,
  type AppInfo,
  type TimelineImportKind,
} from "@path/shared";
import type { AiCredentialStore } from "../storage/AiCredentialStore";
import type { AssetDeletionQueue } from "../storage/AssetDeletionQueue";
import type { RemoteRepositories } from "../storage/DatabaseClient";
import type { GuideDocumentService } from "../documents/GuideDocumentService";
import { listProviderModels } from "../ai/ProviderModels";
import type { RendererFlush } from "./RendererFlush";
import type { ManagedRecordingAssets } from "../storage/ManagedRecordingAssets";
import type { TrayController } from "../tray/TrayController";
import { applyWindowTitleBarTheme } from "../windows/SettingsWindow";
import type { RecordingController } from "../recording/RecordingController";
import type { RegionSelector } from "../recording/RegionSelector";
import type { RecordingMediaServer } from "../media/RecordingMediaServer";
import type { DesktopSettingsService } from "../settings/DesktopSettingsService";
import type { InstructionFlowService } from "../settings/InstructionFlowService";
import type { SelectedAiService } from "../ai/SelectedAiService";
import type { TimelineImportService } from "../recording/TimelineImportService";

export interface IpcDependencies {
  cliTools: CliToolService;
  recordings: RemoteRepositories["recordings"];
  projects: RemoteRepositories["projects"];
  documents: GuideDocumentService;
  assets: Pick<ManagedRecordingAssets, "isManagedFile">;
  assetDeletions: Pick<AssetDeletionQueue, "process">;
  rendererFlush: Pick<RendererFlush, "acknowledge">;
  tray: TrayController;
  recording: RecordingController;
  captureWorker: BrowserWindow;
  regionSelector: RegionSelector;
  mediaServer: RecordingMediaServer;
  dataDirectory: string;
  aiCredentials: AiCredentialStore;
  settings: DesktopSettingsService;
  instructionFlows: InstructionFlowService;
  aiService: SelectedAiService;
  timelineImports: TimelineImportService;
  openSettingsWindow(section?: string): void;
}

const TIMELINE_IMPORT_FILE_FILTERS: Record<TimelineImportKind, Electron.FileFilter[]> = {
  log: [
    { name: "Log files", extensions: ["log", "txt", "jsonl", "json", "csv"] },
    { name: "All files", extensions: ["*"] },
  ],
  element: [
    { name: "Element files", extensions: ["txt", "jsonl", "json", "log", "csv"] },
    { name: "All files", extensions: ["*"] },
  ],
};

function platform(): AppInfo["platform"] {
  return ["darwin", "win32", "linux"].includes(process.platform)
    ? (process.platform as AppInfo["platform"])
    : "other";
}

// Validate renderer input here, then delegate state changes to their main-process owners.
export function registerIpcHandlers({
  cliTools,
  recordings,
  projects,
  documents,
  assets,
  assetDeletions,
  rendererFlush,
  tray,
  recording,
  captureWorker,
  regionSelector,
  mediaServer,
  dataDirectory,
  aiCredentials,
  settings,
  instructionFlows,
  aiService,
  timelineImports,
  openSettingsWindow,
}: IpcDependencies): void {
  ipcMain.handle(IPC_CHANNELS.cliGet, () => cliTools.get());
  ipcMain.handle(IPC_CHANNELS.cliRefresh, (_event, input: unknown) => {
    const parsed = input === undefined ? undefined : cliModelsInputSchema.parse(input);

    return cliTools.refresh(parsed?.tool, parsed?.model);
  });
  ipcMain.handle(IPC_CHANNELS.cliConnect, (_event, input: unknown) => {
    const parsed = cliConnectSchema.parse(input);

    return cliTools.connect(parsed.tool, parsed.connected);
  });
  ipcMain.handle(IPC_CHANNELS.cliSelect, (_event, input: unknown) =>
    cliTools.select(cliSelectionSchema.parse(input)),
  );
  ipcMain.handle(IPC_CHANNELS.cliSetMode, (_event, input: unknown) =>
    cliTools.setMode(cliModeSchema.parse(input).mode),
  );
  ipcMain.handle(IPC_CHANNELS.cliChooseFolder, async (event) => {
    if (cliTools.get().mode !== "cli") throw new Error("Select CLI Tool first");
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = { properties: ["openDirectory"] as Array<"openDirectory"> };
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled || !result.filePaths[0]) return null;

    return cliTools.allowFolder(result.filePaths[0]);
  });
  ipcMain.handle(
    IPC_CHANNELS.appInfo,
    () => ({ version: app.getVersion(), platform: platform(), dataDirectory }) satisfies AppInfo,
  );
  ipcMain.handle(IPC_CHANNELS.appShowTrayMenu, () => tray.popUpContextMenu());
  ipcMain.handle(IPC_CHANNELS.appShowMainWindow, () => tray.showMainWindow());
  ipcMain.handle(IPC_CHANNELS.appSetRecorderPopoverExpanded, (_event, input: unknown) => {
    const { expanded } = recorderPopoverExpandedInputSchema.parse(input);

    tray.setRecorderPopoverExpanded(expanded);
  });
  ipcMain.handle(IPC_CHANNELS.appSetTitleBarTheme, (event, input: unknown) => {
    const { theme, dimmed = false } = titleBarThemeInputSchema.parse(input);
    const window = BrowserWindow.fromWebContents(event.sender);

    if (window) applyWindowTitleBarTheme(window, theme, dimmed);
  });
  ipcMain.handle(IPC_CHANNELS.appOpenSettings, (_event, input: unknown) => {
    const { section } = openSettingsInputSchema.parse(input ?? {});

    openSettingsWindow(section);
  });
  ipcMain.handle(IPC_CHANNELS.appFlushComplete, (event, input: unknown) => {
    const { requestId } = appFlushCompleteInputSchema.parse(input);

    rendererFlush.acknowledge(event.sender.id, requestId);
  });

  ipcMain.handle(IPC_CHANNELS.instructionFlowsGet, () => instructionFlows.get());
  ipcMain.handle(IPC_CHANNELS.instructionFlowsSelect, (_event, input: unknown) =>
    instructionFlows.select(instructionFlowIdInputSchema.parse(input)),
  );
  ipcMain.handle(IPC_CHANNELS.instructionFlowsSave, (_event, input: unknown) =>
    instructionFlows.save(saveInstructionFlowInputSchema.parse(input)),
  );
  ipcMain.handle(IPC_CHANNELS.instructionFlowsRemove, (_event, input: unknown) =>
    instructionFlows.remove(instructionFlowIdInputSchema.parse(input)),
  );

  ipcMain.handle(IPC_CHANNELS.settingsGet, () => settings.get());
  ipcMain.handle(IPC_CHANNELS.settingsUpdateGeneral, (_event, input: unknown) =>
    settings.updateGeneral(updateGeneralSettingsInputSchema.parse(input)),
  );
  ipcMain.handle(IPC_CHANNELS.settingsUpdateTimelineImports, (_event, input: unknown) =>
    settings.updateTimelineImports(updateTimelineImportSettingsInputSchema.parse(input)),
  );
  ipcMain.handle(IPC_CHANNELS.settingsChooseRecordingsDirectory, async (event) => {
    // An active capture must keep the same managed root until its assets finish processing.
    if (isActiveRecordingStatus(recording.getState().status)) {
      throw new Error("The recording location cannot be changed while a recording is active");
    }

    const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const result = owner
      ? await dialog.showOpenDialog(owner, { properties: ["openDirectory", "createDirectory"] })
      : await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });

    if (result.canceled || !result.filePaths[0]) return null;

    return settings.updateRecordingsDirectory(result.filePaths[0]);
  });
  ipcMain.handle(IPC_CHANNELS.settingsOpenRecordingsDirectory, async () => {
    const error = await shell.openPath(settings.get().recordingsDirectory);

    if (error) throw new Error(error);
  });

  ipcMain.handle(IPC_CHANNELS.settingsGetAiProviderKeyStatus, () => aiCredentials.getStatus());
  ipcMain.handle(IPC_CHANNELS.settingsRemoveAiProviderKey, (_event, input: unknown) => {
    const { provider } = aiProviderInputSchema.parse(input);

    return aiCredentials.remove(provider);
  });
  ipcMain.handle(IPC_CHANNELS.settingsSetAiProviderKey, async (_event, input: unknown) => {
    const { provider, key } = setAiProviderKeyInputSchema.parse(input);

    // Validate the key with its provider before replacing the encrypted local credential.
    const models = await listProviderModels(provider, key);

    if (models.length === 0) {
      throw new Error(`${provider} returned no compatible models`);
    }

    const keyStatus = await aiCredentials.set(provider, key);

    return { keyStatus, models };
  });
  ipcMain.handle(IPC_CHANNELS.settingsListAiProviderModels, async (_event, input: unknown) => {
    const { provider } = aiProviderInputSchema.parse(input);
    const key = await aiCredentials.get(provider);

    if (!key) throw new Error(`No ${provider} API key is configured`);

    return listProviderModels(provider, key);
  });

  ipcMain.handle(IPC_CHANNELS.settingsListLocalModels, () => aiService.listLocalModels());
  ipcMain.handle(IPC_CHANNELS.settingsListAvailableAiModels, () => aiService.listModels());
  ipcMain.handle(IPC_CHANNELS.settingsUpdateAiModelSelection, async (_event, input: unknown) => {
    const { purpose, selection } = updateAiModelSelectionInputSchema.parse(input);
    const available = await aiService.listModels();
    const exists =
      selection.source === "local"
        ? available.local.some(
            (model) => model.id === selection.modelId && model.supportedPurposes.includes(purpose),
          )
        : available.api.some(
            (model) =>
              model.provider === selection.provider &&
              model.id === selection.modelId &&
              model.supportedPurposes.includes(purpose),
          );

    if (!exists) throw new Error(`The selected ${purpose} model is not available`);

    return settings.updateAiModelSelection(purpose, selection);
  });

  ipcMain.handle(IPC_CHANNELS.guidesGenerate, (_event, input: unknown) =>
    documents.generate(generateGuideInputSchema.parse(input)),
  );
  ipcMain.handle(IPC_CHANNELS.guidesUpdate, (_event, input: unknown) =>
    documents.update(updateGuideInputSchema.parse(input)),
  );
  ipcMain.handle(IPC_CHANNELS.guidesExportMarkdown, async (event, input: unknown) => {
    const { suggestedName, markdown } = exportMarkdownInputSchema.parse(input);
    const safeName = suggestedName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").trim() || "guide";
    const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const options = {
      defaultPath: `${safeName}.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    };

    const result = owner
      ? await dialog.showSaveDialog(owner, options)
      : await dialog.showSaveDialog(options);

    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, markdown, "utf8");

    return true;
  });
  ipcMain.handle(IPC_CHANNELS.guidesGetDocument, (_event, input: unknown) => {
    const { id } = recordingIdInputSchema.parse(input);

    return documents.getDocument(id);
  });
  ipcMain.handle(IPC_CHANNELS.guidesSaveDocument, (_event, input: unknown) =>
    documents.save(saveGuideDocumentInputSchema.parse(input)),
  );
  ipcMain.handle(IPC_CHANNELS.guidesSaveDraft, (_event, input: unknown) =>
    documents.saveDraft(saveGuideDraftInputSchema.parse(input)),
  );
  ipcMain.handle(IPC_CHANNELS.guidesDiscardDraft, (_event, input: unknown) =>
    documents.discardDraft(discardGuideDraftInputSchema.parse(input)),
  );
  ipcMain.handle(IPC_CHANNELS.guidesListRevisions, (_event, input: unknown) =>
    documents.listRevisions(listGuideRevisionsInputSchema.parse(input)),
  );
  ipcMain.handle(IPC_CHANNELS.guidesGetRevision, (_event, input: unknown) =>
    documents.getRevision(guideRevisionInputSchema.parse(input)),
  );
  ipcMain.handle(IPC_CHANNELS.guidesRestoreRevision, (_event, input: unknown) =>
    documents.restoreRevision(restoreGuideRevisionInputSchema.parse(input)),
  );

  ipcMain.handle(IPC_CHANNELS.projectsList, () => projects.list());
  ipcMain.handle(IPC_CHANNELS.projectsChange, (_event, input: unknown) => {
    return projects.change(projectChangeInputSchema.parse(input));
  });

  ipcMain.handle(IPC_CHANNELS.recordingsList, () => recordings.list());
  ipcMain.handle(IPC_CHANNELS.recordingsGet, (_event, input: unknown) => {
    const { id } = recordingIdInputSchema.parse(input);

    return recordings.get(id);
  });
  ipcMain.handle(IPC_CHANNELS.recordingsRename, (_event, input: unknown) => {
    const { id, title } = renameRecordingInputSchema.parse(input);

    return recordings.rename(id, title);
  });
  ipcMain.handle(IPC_CHANNELS.recordingsDelete, async (_event, input: unknown) => {
    const { id } = recordingIdInputSchema.parse(input);

    // Rows and the deletion intent commit together; files are removed after, and retried.
    await recordings.delete(id);
    void assetDeletions.process();
  });
  ipcMain.handle(IPC_CHANNELS.recordingsMediaUrl, (_event, input: unknown) => {
    const { id } = recordingIdInputSchema.parse(input);

    return mediaServer.url(id);
  });
  ipcMain.handle(IPC_CHANNELS.recordingsThumbnailUrl, async (_event, input: unknown) => {
    const { id } = recordingIdInputSchema.parse(input);
    const thumbnailPath = (await recordings.get(id))?.thumbnailPath;

    if (!thumbnailPath || !assets.isManagedFile(thumbnailPath)) {
      return null;
    }

    try {
      await stat(thumbnailPath);
    } catch {
      return null;
    }

    return mediaServer.thumbnailUrl(id);
  });
  ipcMain.handle(IPC_CHANNELS.recordingsListClicks, (_event, input: unknown) => {
    const { id } = recordingIdInputSchema.parse(input);

    return recordings.listClicks(id);
  });
  ipcMain.handle(IPC_CHANNELS.recordingsAnalyzeClicks, async (_event, input: unknown) => {
    const { id } = recordingIdInputSchema.parse(input);
    const existing = await recordings.get(id);

    if (!existing) throw new Error(`Recording not found: ${id}`);
    if (existing.status !== "ready") {
      throw new Error("Clicks can only be analyzed for a ready recording");
    }

    return recording.analyzeClicks(id);
  });
  ipcMain.handle(IPC_CHANNELS.recordingsScreenshotUrl, (_event, input: unknown) => {
    const { recordingId, clickId } = clickAssetInputSchema.parse(input);

    return mediaServer.screenshotUrl(recordingId, clickId);
  });
  ipcMain.handle(IPC_CHANNELS.recordingsRevealScreenshot, async (_event, input: unknown) => {
    const { recordingId, clickId } = clickAssetInputSchema.parse(input);
    const click = await recordings.getClick(recordingId, clickId);

    if (!click?.screenshotPath) {
      throw new Error(`Screenshot not found for click: ${clickId}`);
    }

    // A database path still needs managed-root validation before opening a native file browser.
    if (!assets.isManagedFile(click.screenshotPath)) {
      throw new Error("Screenshot is outside the managed recording directories");
    }

    await stat(click.screenshotPath);
    shell.showItemInFolder(click.screenshotPath);
  });
  ipcMain.handle(IPC_CHANNELS.recordingsListTranscript, (_event, input: unknown) => {
    const { id } = recordingIdInputSchema.parse(input);

    return recordings.listTranscript(id);
  });
  ipcMain.handle(IPC_CHANNELS.recordingsUpdateTranscript, (_event, input: unknown) => {
    const { recordingId, id, text } = updateTranscriptInputSchema.parse(input);

    return recordings.updateTranscript(recordingId, id, text);
  });
  ipcMain.handle(IPC_CHANNELS.recordingsDeleteTranscript, (_event, input: unknown) => {
    const { recordingId, id } = activityItemInputSchema.parse(input);

    return recordings.deleteTranscript(recordingId, id);
  });
  ipcMain.handle(IPC_CHANNELS.recordingsUpdateClick, (_event, input: unknown) => {
    const { recordingId, id, description } = updateClickDescriptionInputSchema.parse(input);

    return recordings.updateClickDescription(recordingId, id, description);
  });
  ipcMain.handle(IPC_CHANNELS.recordingsRetryProcessing, (_event, input: unknown) => {
    const { id } = recordingIdInputSchema.parse(input);

    return recording.retryProcessing(id);
  });
  ipcMain.handle(IPC_CHANNELS.recordingsListTimelineImports, (_event, input: unknown) => {
    const { id } = recordingIdInputSchema.parse(input);

    return timelineImports.list(id);
  });
  ipcMain.handle(IPC_CHANNELS.recordingsListTimelineImportRows, (_event, input: unknown) => {
    const { recordingId, kind, start, limit, query } = timelineImportRowsInputSchema.parse(input);

    return timelineImports.listRows(recordingId, kind, start, limit, query);
  });
  ipcMain.handle(IPC_CHANNELS.recordingsLocateTimelineImportRow, async (_event, input: unknown) => {
    const { recordingId, kind, timestampMs, query } =
      locateTimelineImportRowInputSchema.parse(input);

    return { index: await timelineImports.locateRow(recordingId, kind, timestampMs, query) };
  });
  ipcMain.handle(IPC_CHANNELS.recordingsImportTimelineFile, (event, input: unknown) => {
    const { recordingId, kind } = timelineImportInputSchema.parse(input);
    const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const options: Electron.OpenDialogOptions = {
      properties: ["openFile"],
      filters: TIMELINE_IMPORT_FILE_FILTERS[kind],
    };

    // The main process chooses the path; the renderer never supplies a filesystem location.
    return timelineImports.importFile(recordingId, kind, async () => {
      const result = owner
        ? await dialog.showOpenDialog(owner, options)
        : await dialog.showOpenDialog(options);

      return result.canceled ? null : (result.filePaths[0] ?? null);
    });
  });
  ipcMain.handle(IPC_CHANNELS.recordingsUpdateTimelineImportOffset, (_event, input: unknown) => {
    const { recordingId, kind, offsetMs } = timelineImportOffsetInputSchema.parse(input);

    return timelineImports.updateOffset(recordingId, kind, offsetMs);
  });
  ipcMain.handle(IPC_CHANNELS.recordingsRemoveTimelineImport, (_event, input: unknown) => {
    const { recordingId, kind } = timelineImportInputSchema.parse(input);

    return timelineImports.remove(recordingId, kind);
  });
  ipcMain.handle(IPC_CHANNELS.recordingsDeleteClick, async (_event, input: unknown) => {
    const { recordingId, id } = activityItemInputSchema.parse(input);

    // The row and its screenshot's deletion intent commit together; the file is removed after.
    await recordings.deleteClick(recordingId, id);
    void assetDeletions.process();
  });

  ipcMain.handle(IPC_CHANNELS.recordingListSources, () => recording.listSources());
  ipcMain.handle(IPC_CHANNELS.recordingStart, (_event, input: unknown) =>
    recording.start(startRecordingInputSchema.parse(input)),
  );
  ipcMain.handle(IPC_CHANNELS.recordingStop, () => recording.stop());
  ipcMain.handle(IPC_CHANNELS.recordingPause, () => recording.pause());
  ipcMain.handle(IPC_CHANNELS.recordingResume, () => recording.resume());
  ipcMain.handle(IPC_CHANNELS.recordingSetClickTracking, (_, input: unknown) =>
    recording.setClickTracking(clickTrackingInputSchema.parse(input)),
  );
  ipcMain.handle(IPC_CHANNELS.recordingGetState, () => recording.getState());

  // Only the dedicated capture worker may acknowledge capture or submit media bytes.
  ipcMain.handle(IPC_CHANNELS.captureReady, (event) => {
    if (event.sender !== captureWorker.webContents) {
      throw new Error("Untrusted capture sender");
    }

    return recording.captureReady();
  });
  ipcMain.handle(IPC_CHANNELS.captureAppendChunk, (event, input: unknown) => {
    if (event.sender !== captureWorker.webContents) {
      throw new Error("Untrusted capture sender");
    }

    if (!(input instanceof Uint8Array)) {
      throw new Error("Invalid recording chunk");
    }

    return recording.appendChunk(input);
  });
  ipcMain.handle(IPC_CHANNELS.captureComplete, (event) => {
    if (event.sender !== captureWorker.webContents) {
      throw new Error("Untrusted capture sender");
    }

    return recording.captureComplete();
  });
  ipcMain.handle(IPC_CHANNELS.captureFailed, (event, input: unknown) => {
    if (event.sender !== captureWorker.webContents) {
      throw new Error("Untrusted capture sender");
    }

    return recording.captureFailed(captureFailureSchema.parse(input).message);
  });

  // The selector verifies each response against the webContents that owns its overlay.
  ipcMain.handle(IPC_CHANNELS.regionSelect, (_event, input: unknown) =>
    regionSelector.select(selectRegionInputSchema.parse(input)),
  );
  ipcMain.handle(IPC_CHANNELS.regionGetContext, (event) =>
    regionSelector.getContext(event.sender.id),
  );
  ipcMain.handle(IPC_CHANNELS.regionConfirm, (event, input: unknown) =>
    regionSelector.confirm(event.sender.id, regionRectangleSchema.parse(input)),
  );
  ipcMain.handle(IPC_CHANNELS.regionCancel, (event) => regionSelector.cancel(event.sender.id));
}
