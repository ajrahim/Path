import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { stat, writeFile } from "node:fs/promises";
import type { RecordingRepository, ProjectRepository } from "@path/database";
import {
  clickAssetInputSchema,
  projectChangeInputSchema,
  exportMarkdownInputSchema,
  generateGuideInputSchema,
  saveGuideDocumentInputSchema,
  updateClickDescriptionInputSchema,
  aiProviderInputSchema,
  activityItemInputSchema,
  IPC_CHANNELS,
  recorderPopoverExpandedInputSchema,
  recordingIdInputSchema,
  renameRecordingInputSchema,
  startRecordingInputSchema,
  captureFailureSchema,
  regionRectangleSchema,
  selectRegionInputSchema,
  setAiProviderKeyInputSchema,
  updateTranscriptInputSchema,
  updateGeneralSettingsInputSchema,
  updateGuideInstructionsInputSchema,
  updateLocalVisionModelInputSchema,
  aiModelSelectionSchema,
  type AppInfo,
} from "@path/shared";
import type { AiCredentialStore } from "../storage/AiCredentialStore";
import {
  buildDocumentActivity,
  buildDocumentPrompt,
  normalizeDocumentMarkdown,
} from "../ai/DocumentPrompt";
import { listProviderModels } from "../ai/ProviderModels";
import type { ManagedRecordingAssets } from "../storage/ManagedRecordingAssets";
import type { TrayController } from "../tray/TrayController";
import type { RecordingController } from "../recording/RecordingController";
import type { RegionSelector } from "../recording/RegionSelector";
import type { RecordingMediaServer } from "../media/RecordingMediaServer";
import type { DesktopSettingsService } from "../settings/DesktopSettingsService";
import type { SelectedAiService } from "../ai/SelectedAiService";

export interface IpcDependencies {
  recordings: RecordingRepository;
  projects: ProjectRepository;
  assets: ManagedRecordingAssets;
  tray: TrayController;
  recording: RecordingController;
  captureWorker: BrowserWindow;
  regionSelector: RegionSelector;
  mediaServer: RecordingMediaServer;
  dataDirectory: string;
  aiCredentials: AiCredentialStore;
  settings: DesktopSettingsService;
  aiService: SelectedAiService;
  openSettingsWindow(): void;
}

function platform(): AppInfo["platform"] {
  return ["darwin", "win32", "linux"].includes(process.platform)
    ? (process.platform as AppInfo["platform"])
    : "other";
}

// Validate renderer input here, then delegate state changes to their main-process owners.
export function registerIpcHandlers({
  recordings,
  projects,
  assets,
  tray,
  recording,
  captureWorker,
  regionSelector,
  mediaServer,
  dataDirectory,
  aiCredentials,
  settings,
  aiService,
  openSettingsWindow,
}: IpcDependencies): void {
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
  ipcMain.handle(IPC_CHANNELS.appOpenSettings, () => openSettingsWindow());

  ipcMain.handle(IPC_CHANNELS.settingsGet, () => settings.get());
  ipcMain.handle(IPC_CHANNELS.settingsUpdateGeneral, (_event, input: unknown) =>
    settings.updateGeneral(updateGeneralSettingsInputSchema.parse(input)),
  );
  ipcMain.handle(IPC_CHANNELS.settingsUpdateGuideInstructions, (_event, input: unknown) => {
    const { guideInstructions } = updateGuideInstructionsInputSchema.parse(input);

    return settings.updateGuideInstructions(guideInstructions);
  });
  ipcMain.handle(IPC_CHANNELS.settingsChooseRecordingsDirectory, async (event) => {
    // An active capture must keep the same managed root until its assets finish processing.
    if (
      ["preparing", "recording", "paused", "stopping", "processing"].includes(
        recording.getState().status,
      )
    ) {
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
  ipcMain.handle(IPC_CHANNELS.settingsUpdateLocalVisionModel, async (_event, input: unknown) => {
    const { model } = updateLocalVisionModelInputSchema.parse(input);
    const availableModels = await aiService.listLocalModels();

    if (!availableModels.some((candidate) => candidate.id === model)) {
      throw new Error(`Local vision model is not available: ${model}`);
    }

    return settings.updateLocalVisionModel(model);
  });
  ipcMain.handle(IPC_CHANNELS.settingsListAvailableAiModels, () => aiService.listModels());
  ipcMain.handle(IPC_CHANNELS.settingsUpdateAiModelSelection, async (_event, input: unknown) => {
    const selection = aiModelSelectionSchema.parse(input);
    const available = await aiService.listModels();
    const exists =
      selection.source === "local"
        ? available.local.some((model) => model.id === selection.modelId)
        : available.api.some(
            (model) => model.provider === selection.provider && model.id === selection.modelId,
          );

    if (!exists) throw new Error("The selected AI model is not available");

    return settings.updateAiModelSelection(selection);
  });

  ipcMain.handle(IPC_CHANNELS.guidesGenerate, async (_event, input: unknown) => {
    const { id, instructions } = generateGuideInputSchema.parse(input);
    const [session, transcript, clicks] = await Promise.all([
      recordings.get(id),
      recordings.listTranscript(id),
      recordings.listClicks(id),
    ]);

    if (!session) throw new Error(`Recording not found: ${id}`);

    const activity = buildDocumentActivity(transcript, clicks);
    const prompt = buildDocumentPrompt(session.title, activity, instructions);
    const markdown = normalizeDocumentMarkdown(await aiService.generateText(prompt));

    if (!markdown) throw new Error("The selected AI model returned no guide");

    return { title: session.title, markdown };
  });
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

    return recordings.getDocument(id);
  });
  ipcMain.handle(IPC_CHANNELS.guidesSaveDocument, (_event, input: unknown) => {
    const { id, markdown } = saveGuideDocumentInputSchema.parse(input);

    return recordings.saveDocument(id, markdown);
  });

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
    const existing = await recordings.get(id);

    await recordings.delete(id);
    await assets.delete(id, existing?.videoPath);
  });
  ipcMain.handle(IPC_CHANNELS.recordingsMediaUrl, (_event, input: unknown) => {
    const { id } = recordingIdInputSchema.parse(input);

    return mediaServer.url(id);
  });
  ipcMain.handle(IPC_CHANNELS.recordingsThumbnailUrl, async (_event, input: unknown) => {
    const { id } = recordingIdInputSchema.parse(input);
    const recording = await recordings.get(id);
    const thumbnailPath = recording?.thumbnailPath ?? assets.thumbnailPath(id);

    if (!assets.isManagedFile(thumbnailPath)) {
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
  ipcMain.handle(IPC_CHANNELS.recordingsDeleteClick, async (_event, input: unknown) => {
    const { recordingId, id } = activityItemInputSchema.parse(input);
    const click = await recordings.getClick(recordingId, id);

    if (!click) throw new Error(`Click event not found: ${id}`);
    if (click.screenshotPath) {
      await assets.deleteFile(click.screenshotPath);
    }

    await recordings.deleteClick(recordingId, id);
  });

  ipcMain.handle(IPC_CHANNELS.recordingListSources, () => recording.listSources());
  ipcMain.handle(IPC_CHANNELS.recordingStart, (_event, input: unknown) =>
    recording.start(startRecordingInputSchema.parse(input)),
  );
  ipcMain.handle(IPC_CHANNELS.recordingStop, () => recording.stop());
  ipcMain.handle(IPC_CHANNELS.recordingPause, () => recording.pause());
  ipcMain.handle(IPC_CHANNELS.recordingResume, () => recording.resume());
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
