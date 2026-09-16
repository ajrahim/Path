import { app, session } from "electron";
import { createRequire } from "node:module";
import { stat } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { AppSettingsRepository, openDatabase, RecordingRepository } from "@path/database";
import { registerIpcHandlers } from "./ipc/RegisterIpc";
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
import { WhisperCppTranscriptProvider } from "@path/transcription";
import { DesktopSettingsService } from "./settings/DesktopSettingsService";
import { OllamaClickActionAnalyzer } from "./ai/OllamaClickActionAnalyzer";
import { SelectedAiService } from "./ai/SelectedAiService";
import { resolveUserDataDirectory } from "./storage/UserDataDirectory";

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
  void app.whenReady().then(async () => {
    if (process.platform === "win32") {
      app.setAppUserModelId("app.path.desktop");
    }

    const dataDirectory = app.getPath("userData");
    const migrationsDirectory = app.isPackaged
      ? join(process.resourcesPath, "migrations")
      : resolve(app.getAppPath(), "../../packages/database/drizzle");

    const rendererDirectory = app.isPackaged
      ? join(process.resourcesPath, "renderer")
      : resolve(app.getAppPath(), "../renderer/out");

    handleRendererScheme(rendererDirectory);
    const rendererUrl = process.env.PATH_APP_RENDERER_URL ?? RENDERER_ORIGIN;
    const connection = openDatabase(join(dataDirectory, "database.sqlite"), migrationsDirectory);
    const recordings = new RecordingRepository(connection.db);
    const appSettings = new AppSettingsRepository(connection.db);
    const defaultRecordingsDirectory = join(dataDirectory, "recordings");
    const assets = new ManagedRecordingAssets(defaultRecordingsDirectory);
    const settings = new DesktopSettingsService(appSettings, assets, defaultRecordingsDirectory);
    const aiCredentials = new AiCredentialStore(
      join(dataDirectory, "credentials", "ai-providers.json"),
    );

    await settings.initialize();

    // Interrupted captures cannot be resumed; recover their status before history is exposed.
    const unfinishedRecordings = await recordings.listUnfinished();

    await recordings.markUnfinishedFailed();

    for (const recording of unfinishedRecordings) {
      await assets.delete(recording.id);
    }

    for (const recording of await recordings.list()) {
      if (recording.status !== "ready") continue;

      const session = await recordings.get(recording.id);

      if (!session?.videoPath || !assets.isManagedFile(session.videoPath)) {
        await recordings.markFailed(recording.id);
        continue;
      }

      try {
        const media = await stat(session.videoPath);

        if (media.size < 1_024) await recordings.markFailed(recording.id);
      } catch {
        await recordings.markFailed(recording.id);
      }
    }

    const mediaServer = new RecordingMediaServer(recordings, assets);

    await mediaServer.start();

    const appIconPath =
      [
        resolve(app.getAppPath(), "assets/app-icon.ico"),
        join(__dirname, "../assets/app-icon.ico"),
        join(process.resourcesPath, "assets/app-icon.ico"),
      ].find((candidate) => existsSync(candidate)) ??
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
    const openSettingsWindow = () => {
      if (settingsWindow && !settingsWindow.isDestroyed()) {
        if (settingsWindow.isMinimized()) settingsWindow.restore();
        settingsWindow.show();
        settingsWindow.focus();

        return;
      }

      settingsWindow = createSettingsWindow(rendererTarget);
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

    const clickCapture = new ClickCaptureCoordinator(recordings, assets, new UiohookInputCapture());

    // The bundled transcription executable is currently available only on Windows.
    const transcriptProvider =
      process.platform === "win32"
        ? new WhisperCppTranscriptProvider({
            executablePath: app.isPackaged
              ? join(process.resourcesPath, "whisper", "whisper-cli.exe")
              : resolve(app.getAppPath(), "vendor/whisper/win32-x64/Release/whisper-cli.exe"),
            modelDirectory: join(dataDirectory, "models", "whisper"),
          })
        : null;

    const ollama = new OllamaClickActionAnalyzer(
      process.env.PATH_APP_LOCAL_VISION_MODEL ?? settings.get().localVisionModel,
      process.env.PATH_APP_OLLAMA_URL,
    );

    const aiService = new SelectedAiService(settings, aiCredentials, ollama);
    const recording = new RecordingController(
      recordings,
      assets,
      captureWorker,
      new FfmpegMediaProcessor(ffmpegPath),
      clickCapture,
      transcriptProvider,
      aiService,
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

    registerIpcHandlers({
      recordings,
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
    });

    let isQuitting = false;

    app.on("before-quit", () => {
      isQuitting = true;
      tray.destroy();
      mediaServer.close();
      connection.close();
    });

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
    app.on("second-instance", () => {
      recordingWindows.restoreMainWindow();
    });
  });
}
