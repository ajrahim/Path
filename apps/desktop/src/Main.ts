import { stopCliProcesses } from "./ai/CliProcess";
import { CliToolService } from "./ai/CliToolService";
import { app, BrowserWindow, dialog, ipcMain, session } from "electron";
import { IPC_CHANNELS } from "@path/shared";
import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { GuideDocumentService } from "./documents/GuideDocumentService";
import { registerIpcHandlers } from "./ipc/RegisterIpc";
import { RendererFlush } from "./ipc/RendererFlush";
import { GenerateLinkService } from "./links/GenerateLinkService";
import { PathLinkNotifications } from "./links/PathLinkNotifications";
import { PathProtocol } from "./links/PathProtocol";
import { recoverRecordings } from "./recording/StartupRecovery";
import { AssetDeletionQueue } from "./storage/AssetDeletionQueue";
import { DatabaseClient, type DatabaseUnavailableError } from "./storage/DatabaseClient";
import { DiagnosticLog } from "./storage/DiagnosticLog";
import { ManagedRecordingAssets } from "./storage/ManagedRecordingAssets";
import { AiCredentialStore } from "./storage/AiCredentialStore";
import { TrayController } from "./tray/TrayController";
import { createMainWindow } from "./windows/MainWindow";
import { createSettingsWindow } from "./windows/SettingsWindow";
import {
  handleRendererScheme,
  registerRendererScheme,
  RENDERER_ORIGIN,
} from "./windows/RendererProtocol";
import {
  createCaptureWorker,
  createRecorderPopover,
  createRecordingToolbar,
} from "./windows/SupportWindows";
import { RecordingWindowController } from "./windows/RecordingWindowController";
import { RecordingController } from "./recording/RecordingController";
import { RegionSelector } from "./recording/RegionSelector";
import { FfmpegMediaProcessor } from "./media/FfmpegMediaProcessor";
import { RecordingMediaServer } from "./media/RecordingMediaServer";
import { UiohookInputCapture } from "./input/UiohookInputCapture";
import { ClickCaptureCoordinator } from "./recording/ClickCaptureCoordinator";
import { TimelineImportService } from "./recording/TimelineImportService";
import { WhisperCppTranscriptProvider } from "@path/transcription";
import { DesktopSettingsService } from "./settings/DesktopSettingsService";
import { InstructionFlowService } from "./settings/InstructionFlowService";
import { OllamaClickActionAnalyzer } from "./ai/OllamaClickActionAnalyzer";
import { SelectedAiService } from "./ai/SelectedAiService";
import {
  createUserDataDirectories,
  resolveUserDataDirectory,
  userDataLayout,
} from "./storage/UserDataDirectory";

// Orderly quit: windows first save pending drafts, then queued database work drains.
const RENDERER_FLUSH_TIMEOUT_MS = 2_000;
const DATABASE_CLOSE_TIMEOUT_MS = 10_000;

app.setName("Path");
const userDataDirectory = resolveUserDataDirectory(
  app.getPath("appData"),
  process.env.PATH_APP_USER_DATA,
);

mkdirSync(userDataDirectory, { recursive: true });

// Set the profile before Electron creates a session or acquires its profile lock.
app.setPath("userData", userDataDirectory);
const hasSingleInstanceLock = app.requestSingleInstanceLock();

registerRendererScheme();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  // macOS can deliver open-url before ready; Windows passes links in initial/second-instance argv.
  const appLinks = new PathProtocol({ app, argv: process.argv, executablePath: process.execPath });

  void app.whenReady().then(async () => {
    if (process.platform === "win32") {
      app.setAppUserModelId(app.isPackaged ? "app.path.desktop" : process.execPath);
    }

    const dataDirectory = app.getPath("userData");
    const layout = userDataLayout(dataDirectory);
    const migrationsDirectory = app.isPackaged
      ? join(process.resourcesPath, "migrations")
      : resolve(app.getAppPath(), "../../packages/database/drizzle");

    const rendererDirectory = app.isPackaged
      ? join(process.resourcesPath, "renderer")
      : resolve(app.getAppPath(), "../renderer/out");

    handleRendererScheme(rendererDirectory);
    const rendererUrl = process.env.PATH_APP_RENDERER_URL ?? RENDERER_ORIGIN;

    await createUserDataDirectories(layout);

    const diagnostics = new DiagnosticLog(layout.logsDirectory);

    await diagnostics.initialize();
    if (!appLinks.register()) diagnostics.warn("Path could not register the pathai protocol");

    // All SQL runs in the database worker; nothing is exposed until migrations and recovery finish.
    let database: DatabaseClient;

    try {
      database = await DatabaseClient.open({
        workerPath: join(__dirname, "database-worker.cjs"),
        databasePath: layout.databasePath,
        migrationsFolder: migrationsDirectory,
        onUnexpectedExit: (error) => void reportDatabaseFailure(error, diagnostics),
      });
    } catch (error) {
      // Never reset or delete the file here: the user's data may still be recoverable.
      diagnostics.error("The local database could not be opened", error);
      await diagnostics.flush();
      dialog.showErrorBox(
        "Path could not open its local data",
        `${error instanceof Error ? error.message : String(error)}\n\nDatabase: ${layout.databasePath}`,
      );
      app.exit(1);

      return;
    }

    const repositories = database.repositories;
    const recordings = repositories.recordings;
    const assets = new ManagedRecordingAssets();
    const assetDeletions = new AssetDeletionQueue(repositories.assetDeletions, assets, diagnostics);
    const settings = new DesktopSettingsService(
      repositories,
      assets,
      layout.defaultRecordingsDirectory,
      diagnostics,
    );

    const instructionFlows = new InstructionFlowService(repositories.appSettings, (state) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (window.isDestroyed() || window.webContents.isDestroyed()) continue;

        window.webContents.send(IPC_CHANNELS.instructionFlowsChanged, state);
      }
    });

    const aiCredentials = new AiCredentialStore(layout.credentialsPath);

    await settings.initialize();
    await instructionFlows.initialize();

    // Interrupted captures cannot be resumed; recover their status before history is exposed.
    await recoverRecordings(recordings, assets, diagnostics);
    void assetDeletions.process();

    const mediaServer = new RecordingMediaServer(recordings, assets);

    await mediaServer.start();

    const appIconPath =
      [
        resolve(app.getAppPath(), "assets/app-icon.ico"),
        join(__dirname, "../assets/app-icon.ico"),
        process.resourcesPath ? join(process.resourcesPath, "assets/app-icon.ico") : null,
      ]
        .filter((candidate): candidate is string => Boolean(candidate))
        .find((candidate) => existsSync(candidate)) ??
      resolve(app.getAppPath(), "assets/app-icon.ico");

    const mainWindow = createMainWindow({
      preloadPath: join(__dirname, "preload.cjs"),
      rendererUrl,
      rendererDirectory,
      iconPath: appIconPath,
    });

    const rendererTarget = {
      preloadPath: join(__dirname, "preload.cjs"),
      rendererUrl,
      rendererDirectory,
      iconPath: appIconPath,
    };

    let settingsWindow: ReturnType<typeof createSettingsWindow> | null = null;
    const openSettingsWindow = (section?: string) => {
      if (settingsWindow && !settingsWindow.isDestroyed()) {
        if (settingsWindow.isMinimized()) settingsWindow.restore();
        settingsWindow.show();
        settingsWindow.focus();
        if (section) {
          void settingsWindow.webContents.executeJavaScript(
            `location.hash = ${JSON.stringify(`#${section}`)}`,
          );
        }

        return;
      }

      settingsWindow = createSettingsWindow(rendererTarget, section);
      settingsWindow.on("closed", () => {
        settingsWindow = null;
      });
    };

    const captureWorker = createCaptureWorker(rendererTarget);
    const recorderWindow = createRecorderPopover(rendererTarget);
    const recordingToolbar = createRecordingToolbar(rendererTarget);
    const require = createRequire(__filename);
    const ffmpegPath = app.isPackaged
      ? join(process.resourcesPath, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg")
      : (require("ffmpeg-static") as string);

    const clickCapture = new ClickCaptureCoordinator(
      recordings,
      assets,
      new UiohookInputCapture(),
      diagnostics,
    );

    // The bundled transcription executable is currently available only on Windows.
    const transcriptProvider =
      process.platform === "win32"
        ? new WhisperCppTranscriptProvider({
            executablePath: app.isPackaged
              ? join(process.resourcesPath, "whisper", "whisper-cli.exe")
              : resolve(app.getAppPath(), "vendor/whisper/win32-x64/Release/whisper-cli.exe"),
            modelDirectory: layout.whisperModelsDirectory,
          })
        : null;

    const ollama = new OllamaClickActionAnalyzer(
      process.env.PATH_APP_LOCAL_VISION_MODEL,
      process.env.PATH_APP_OLLAMA_URL,
    );

    const cliTools = new CliToolService(
      repositories.appSettings,
      layout.cliWorkDirectory,
      (state) => {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send(IPC_CHANNELS.cliChanged, state);
        }
      },
    );

    await cliTools.initialize();
    const aiService = new SelectedAiService(settings, aiCredentials, ollama, cliTools);
    const recording = new RecordingController(
      recordings,
      assets,
      captureWorker,
      new FfmpegMediaProcessor(ffmpegPath),
      clickCapture,
      transcriptProvider,
      aiService,
      diagnostics,
    );

    const regionSelector = new RegionSelector(rendererTarget);

    // Grant capture only for the source selected by the active recording controller.
    session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
      const source = await recording.selectedDesktopSource();

      callback(source ? { video: source } : {});
    });

    const tray = new TrayController(mainWindow, recorderWindow);
    const recordingWindows = new RecordingWindowController(
      mainWindow,
      recorderWindow,
      recordingToolbar,
    );

    recording.onStateChanged((state) => {
      tray.setRecordingState(state.status);
      recordingWindows.update(state);
    });

    const timelineImports = new TimelineImportService(repositories, database, settings);
    const documents = new GuideDocumentService(
      repositories,
      timelineImports,
      aiService,
      diagnostics,
      (change) => {
        for (const window of BrowserWindow.getAllWindows()) {
          if (window.isDestroyed() || window.webContents.isDestroyed()) continue;

          window.webContents.send(IPC_CHANNELS.guidesChanged, change);
        }
      },
    );

    const rendererFlush = new RendererFlush();

    let pendingRecordingOpen: { recordingId: string } | null = null;
    const openLinkedRecording = (recordingId: string) => {
      pendingRecordingOpen = { recordingId };
      recordingWindows.restoreMainWindow();
      if (!mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.appRecordingOpened, pendingRecordingOpen);
      }
    };

    ipcMain.handle(IPC_CHANNELS.appConsumeRecordingOpened, (event) => {
      if (event.sender !== mainWindow.webContents) return null;
      const request = pendingRecordingOpen;

      pendingRecordingOpen = null;

      return request;
    });

    const linkNotifications = new PathLinkNotifications((recordingId) => {
      if (recordingId) openLinkedRecording(recordingId);
      else recordingWindows.restoreMainWindow();
    }, diagnostics);

    const linkedGeneration = new GenerateLinkService({
      recording,
      recordings,
      projects: repositories.projects,
      documents,
      timelineImports,
      instructionFlows,
      settings,
      notify: (phase, title, recordingId) => linkNotifications.show(phase, title, recordingId),
      openRecording: openLinkedRecording,
    });

    registerIpcHandlers({
      cliTools,
      recordings,
      projects: repositories.projects,
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
    });

    appLinks.attach({
      onLaunch: () => recordingWindows.restoreMainWindow(),
      onStatus: () => linkNotifications.showStatus(),
      dispatch: async (link) => {
        recordingWindows.restoreMainWindow();
        if (link.route === "generate") await linkedGeneration.generate(link);
      },
      onError: (error) => {
        diagnostics.error("A Path app link could not be completed", error);
        linkNotifications.show(
          "failed",
          error instanceof Error ? error.message : "The request could not be completed.",
        );
      },
    });

    let isQuitting = false;
    let isShutdownStarted = false;

    // The first quit request is deferred until durable work is flushed; the second proceeds.
    app.on("before-quit", (event) => {
      isQuitting = true;

      if (isShutdownStarted) return;

      isShutdownStarted = true;
      event.preventDefault();
      void flushBeforeQuit().finally(() => app.quit());
    });

    async function flushBeforeQuit(): Promise<void> {
      // Finish accepted imports/generation before closing their worker or stopping CLI processes.
      await appLinks.shutdown();
      stopCliProcesses();
      tray.destroy();
      mediaServer.close();

      try {
        const unacknowledged = await rendererFlush.flushAll(
          BrowserWindow.getAllWindows().map((window) => window.webContents),
          RENDERER_FLUSH_TIMEOUT_MS,
        );

        if (unacknowledged > 0) {
          diagnostics.warn(`${unacknowledged} windows did not confirm their pending writes`);
        }

        await clickCapture.flush();
        await assetDeletions.process();
        await database.close(DATABASE_CLOSE_TIMEOUT_MS);
      } catch (error) {
        diagnostics.error("Shutdown did not complete cleanly", error);
      } finally {
        await diagnostics.flush();
      }
    }

    // Closing a window may hide it; process shutdown must bypass that behavior.
    mainWindow.on("close", (event) => {
      if (isQuitting) return;

      event.preventDefault();

      if (settings.get().general.minimizeToTray) {
        mainWindow.hide();
      } else {
        app.quit();
      }
    });
    app.on("activate", () => {
      recordingWindows.restoreMainWindow();
    });
  });
}

/** The worker stopped unexpectedly; data already committed is safe, so offer a restart. */
async function reportDatabaseFailure(
  error: DatabaseUnavailableError,
  diagnostics: DiagnosticLog,
): Promise<void> {
  diagnostics.error("The database worker stopped unexpectedly", error);
  await diagnostics.flush();

  const { response } = await dialog.showMessageBox({
    type: "error",
    title: "Path",
    message: "Path's local database stopped unexpectedly.",
    detail: "Saved work is safe. Restart Path to continue.",
    buttons: ["Restart Path", "Quit"],
    defaultId: 0,
  });

  if (response === 0) app.relaunch();
  app.exit(1);
}
