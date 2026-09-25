import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS, type DesktopApi } from "@path/shared";

// Work that must finish before quit; main waits for one acknowledgment per window.
const flushListeners = new Set<() => Promise<void>>();

ipcRenderer.on(IPC_CHANNELS.appFlushRequested, (_event, requestId: number) => {
  void Promise.allSettled([...flushListeners].map((flush) => flush())).then(() =>
    ipcRenderer.invoke(IPC_CHANNELS.appFlushComplete, { requestId }),
  );
});

// Expose the typed application contract without exposing Electron event objects or raw IPC.
const desktopApi: DesktopApi = {
  app: {
    getInfo: () => ipcRenderer.invoke(IPC_CHANNELS.appInfo),
    showTrayMenu: () => ipcRenderer.invoke(IPC_CHANNELS.appShowTrayMenu),
    showMainWindow: () => ipcRenderer.invoke(IPC_CHANNELS.appShowMainWindow),
    setRecorderPopoverExpanded: (input) =>
      ipcRenderer.invoke(IPC_CHANNELS.appSetRecorderPopoverExpanded, input),
    setTitleBarTheme: (input) => ipcRenderer.invoke(IPC_CHANNELS.appSetTitleBarTheme, input),
    openSettings: (input) => ipcRenderer.invoke(IPC_CHANNELS.appOpenSettings, input),
    clearData: (input) => ipcRenderer.invoke(IPC_CHANNELS.appClearData, input),
    consumeRecordingOpened: () => ipcRenderer.invoke(IPC_CHANNELS.appConsumeRecordingOpened),
    onRecordingOpened: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, input: Parameters<typeof listener>[0]) =>
        listener(input);

      ipcRenderer.on(IPC_CHANNELS.appRecordingOpened, handler);

      return () => ipcRenderer.removeListener(IPC_CHANNELS.appRecordingOpened, handler);
    },
    onFlushRequested: (listener) => {
      flushListeners.add(listener);

      return () => flushListeners.delete(listener);
    },
  },
  cli: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.cliGet),
    refresh: (input) => ipcRenderer.invoke(IPC_CHANNELS.cliRefresh, input),
    connect: (input) => ipcRenderer.invoke(IPC_CHANNELS.cliConnect, input),
    select: (input) => ipcRenderer.invoke(IPC_CHANNELS.cliSelect, input),
    setMode: (input) => ipcRenderer.invoke(IPC_CHANNELS.cliSetMode, input),
    chooseFolder: () => ipcRenderer.invoke(IPC_CHANNELS.cliChooseFolder),
    onChanged: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) =>
        listener(state);

      ipcRenderer.on(IPC_CHANNELS.cliChanged, handler);

      return () => ipcRenderer.removeListener(IPC_CHANNELS.cliChanged, handler);
    },
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.settingsGet),
    updateGeneral: (input) => ipcRenderer.invoke(IPC_CHANNELS.settingsUpdateGeneral, input),
    updateTimelineImports: (input) =>
      ipcRenderer.invoke(IPC_CHANNELS.settingsUpdateTimelineImports, input),
    chooseRecordingsDirectory: () =>
      ipcRenderer.invoke(IPC_CHANNELS.settingsChooseRecordingsDirectory),
    openRecordingsDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.settingsOpenRecordingsDirectory),
    getAiProviderKeyStatus: () => ipcRenderer.invoke(IPC_CHANNELS.settingsGetAiProviderKeyStatus),
    setAiProviderKey: (input) => ipcRenderer.invoke(IPC_CHANNELS.settingsSetAiProviderKey, input),
    removeAiProviderKey: (input) =>
      ipcRenderer.invoke(IPC_CHANNELS.settingsRemoveAiProviderKey, input),
    listAvailableAiModels: () => ipcRenderer.invoke(IPC_CHANNELS.settingsListAvailableAiModels),
    updateAiModelSelection: (input) =>
      ipcRenderer.invoke(IPC_CHANNELS.settingsUpdateAiModelSelection, input),
  },
  instructionFlows: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.instructionFlowsGet),
    select: (input) => ipcRenderer.invoke(IPC_CHANNELS.instructionFlowsSelect, input),
    save: (input) => ipcRenderer.invoke(IPC_CHANNELS.instructionFlowsSave, input),
    remove: (input) => ipcRenderer.invoke(IPC_CHANNELS.instructionFlowsRemove, input),
    onChanged: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) =>
        listener(state);

      ipcRenderer.on(IPC_CHANNELS.instructionFlowsChanged, handler);

      return () => ipcRenderer.removeListener(IPC_CHANNELS.instructionFlowsChanged, handler);
    },
  },
  guides: {
    generate: (input) => ipcRenderer.invoke(IPC_CHANNELS.guidesGenerate, input),
    update: (input) => ipcRenderer.invoke(IPC_CHANNELS.guidesUpdate, input),
    exportMarkdown: (input) => ipcRenderer.invoke(IPC_CHANNELS.guidesExportMarkdown, input),
    getDocument: (input) => ipcRenderer.invoke(IPC_CHANNELS.guidesGetDocument, input),
    saveDocument: (input) => ipcRenderer.invoke(IPC_CHANNELS.guidesSaveDocument, input),
    saveDraft: (input) => ipcRenderer.invoke(IPC_CHANNELS.guidesSaveDraft, input),
    discardDraft: (input) => ipcRenderer.invoke(IPC_CHANNELS.guidesDiscardDraft, input),
    listRevisions: (input) => ipcRenderer.invoke(IPC_CHANNELS.guidesListRevisions, input),
    getRevision: (input) => ipcRenderer.invoke(IPC_CHANNELS.guidesGetRevision, input),
    restoreRevision: (input) => ipcRenderer.invoke(IPC_CHANNELS.guidesRestoreRevision, input),
    onChanged: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, change: Parameters<typeof listener>[0]) =>
        listener(change);

      ipcRenderer.on(IPC_CHANNELS.guidesChanged, handler);

      return () => ipcRenderer.removeListener(IPC_CHANNELS.guidesChanged, handler);
    },
  },
  projects: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.projectsList),
    change: (input) => ipcRenderer.invoke(IPC_CHANNELS.projectsChange, input),
  },
  recordings: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.recordingsList),
    get: (input) => ipcRenderer.invoke(IPC_CHANNELS.recordingsGet, input),
    rename: (input) => ipcRenderer.invoke(IPC_CHANNELS.recordingsRename, input),
    delete: (input) => ipcRenderer.invoke(IPC_CHANNELS.recordingsDelete, input),
    mediaUrl: (input) => ipcRenderer.invoke(IPC_CHANNELS.recordingsMediaUrl, input),
    thumbnailUrl: (input) => ipcRenderer.invoke(IPC_CHANNELS.recordingsThumbnailUrl, input),
    listClicks: (input) => ipcRenderer.invoke(IPC_CHANNELS.recordingsListClicks, input),
    analyzeClicks: (input) => ipcRenderer.invoke(IPC_CHANNELS.recordingsAnalyzeClicks, input),
    screenshotUrl: (input) => ipcRenderer.invoke(IPC_CHANNELS.recordingsScreenshotUrl, input),
    revealScreenshot: (input) => ipcRenderer.invoke(IPC_CHANNELS.recordingsRevealScreenshot, input),
    listTranscript: (input) => ipcRenderer.invoke(IPC_CHANNELS.recordingsListTranscript, input),
    updateTranscript: (input) => ipcRenderer.invoke(IPC_CHANNELS.recordingsUpdateTranscript, input),
    deleteTranscript: (input) => ipcRenderer.invoke(IPC_CHANNELS.recordingsDeleteTranscript, input),
    deleteClick: (input) => ipcRenderer.invoke(IPC_CHANNELS.recordingsDeleteClick, input),
    updateClick: (input) => ipcRenderer.invoke(IPC_CHANNELS.recordingsUpdateClick, input),
    retryProcessing: (input) => ipcRenderer.invoke(IPC_CHANNELS.recordingsRetryProcessing, input),
    listTimelineImports: (input) =>
      ipcRenderer.invoke(IPC_CHANNELS.recordingsListTimelineImports, input),
    listTimelineImportRows: (input) =>
      ipcRenderer.invoke(IPC_CHANNELS.recordingsListTimelineImportRows, input),
    locateTimelineImportRow: (input) =>
      ipcRenderer.invoke(IPC_CHANNELS.recordingsLocateTimelineImportRow, input),
    importTimelineFile: (input) =>
      ipcRenderer.invoke(IPC_CHANNELS.recordingsImportTimelineFile, input),
    updateTimelineImportOffset: (input) =>
      ipcRenderer.invoke(IPC_CHANNELS.recordingsUpdateTimelineImportOffset, input),
    removeTimelineImport: (input) =>
      ipcRenderer.invoke(IPC_CHANNELS.recordingsRemoveTimelineImport, input),
  },
  recording: {
    listSources: () => ipcRenderer.invoke(IPC_CHANNELS.recordingListSources),
    start: (input) => ipcRenderer.invoke(IPC_CHANNELS.recordingStart, input),
    stop: () => ipcRenderer.invoke(IPC_CHANNELS.recordingStop),
    pause: () => ipcRenderer.invoke(IPC_CHANNELS.recordingPause),
    resume: () => ipcRenderer.invoke(IPC_CHANNELS.recordingResume),
    setClickTracking: (enabled) =>
      ipcRenderer.invoke(IPC_CHANNELS.recordingSetClickTracking, enabled),
    getState: () => ipcRenderer.invoke(IPC_CHANNELS.recordingGetState),
    selectRegion: (input) => ipcRenderer.invoke(IPC_CHANNELS.regionSelect, input),
    onStateChanged: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) =>
        listener(state);

      ipcRenderer.on(IPC_CHANNELS.recordingStateChanged, handler);

      return () => ipcRenderer.removeListener(IPC_CHANNELS.recordingStateChanged, handler);
    },
  },
  capture: {
    ready: () => ipcRenderer.invoke(IPC_CHANNELS.captureReady),
    appendChunk: (chunk) => ipcRenderer.invoke(IPC_CHANNELS.captureAppendChunk, chunk),
    complete: () => ipcRenderer.invoke(IPC_CHANNELS.captureComplete),
    fail: (message) => ipcRenderer.invoke(IPC_CHANNELS.captureFailed, { message }),
    onStartRequested: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, input: Parameters<typeof listener>[0]) =>
        listener(input);

      ipcRenderer.on(IPC_CHANNELS.captureStartRequested, handler);

      return () => ipcRenderer.removeListener(IPC_CHANNELS.captureStartRequested, handler);
    },
    onStopRequested: (listener) => {
      const handler = () => listener();

      ipcRenderer.on(IPC_CHANNELS.captureStopRequested, handler);

      return () => ipcRenderer.removeListener(IPC_CHANNELS.captureStopRequested, handler);
    },
    onPauseRequested: (listener) => {
      const handler = () => listener();

      ipcRenderer.on(IPC_CHANNELS.capturePauseRequested, handler);

      return () => ipcRenderer.removeListener(IPC_CHANNELS.capturePauseRequested, handler);
    },
    onResumeRequested: (listener) => {
      const handler = () => listener();

      ipcRenderer.on(IPC_CHANNELS.captureResumeRequested, handler);

      return () => ipcRenderer.removeListener(IPC_CHANNELS.captureResumeRequested, handler);
    },
  },
  region: {
    getContext: () => ipcRenderer.invoke(IPC_CHANNELS.regionGetContext),
    confirm: (rectangle) => ipcRenderer.invoke(IPC_CHANNELS.regionConfirm, rectangle),
    cancel: () => ipcRenderer.invoke(IPC_CHANNELS.regionCancel),
  },
};

contextBridge.exposeInMainWorld("desktop", desktopApi);
