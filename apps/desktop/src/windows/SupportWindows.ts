import { RENDERER_ROUTES } from "@path/shared";
import { BrowserWindow, type BrowserWindowConstructorOptions } from "electron";
import { join } from "node:path";

interface RendererTarget {
  preloadPath: string;
  rendererUrl?: string;
  rendererDirectory: string;
  iconPath?: string;
}

function loadRoute(window: BrowserWindow, target: RendererTarget, route: string): void {
  if (target.rendererUrl) {
    void window.loadURL(`${target.rendererUrl}${route}`);
  } else {
    const routeDirectory =
      route === "/" ? target.rendererDirectory : join(target.rendererDirectory, route);

    void window.loadFile(join(routeDirectory, "index.html"));
  }
}

function webPreferences(preloadPath: string): BrowserWindowConstructorOptions["webPreferences"] {
  return { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: preloadPath };
}

export function createCaptureWorker(target: RendererTarget): BrowserWindow {
  // MediaRecorder lives in an isolated hidden renderer rather than the visible workspace.
  const window = new BrowserWindow({
    width: 320,
    height: 200,
    show: false,
    skipTaskbar: true,
    webPreferences: webPreferences(target.preloadPath),
  });

  loadRoute(window, target, RENDERER_ROUTES.capture);

  return window;
}

export function createRecorderPopover(target: RendererTarget): BrowserWindow {
  const window = new BrowserWindow({
    width: 400,
    height: 80,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: "#00000000",
    webPreferences: webPreferences(target.preloadPath),
  });

  // Keep recorder controls out of captured screenshots and video on supported platforms.
  window.setContentProtection(true);
  window.on("blur", () => window.hide());
  loadRoute(window, target, RENDERER_ROUTES.recorder);

  return window;
}

export function createRecordingToolbar(target: RendererTarget): BrowserWindow {
  const window = new BrowserWindow({
    width: 380,
    height: 72,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    backgroundColor: "#00000000",
    webPreferences: webPreferences(target.preloadPath),
  });

  window.setContentProtection(true);
  window.setAlwaysOnTop(true, "floating");
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  loadRoute(window, target, RENDERER_ROUTES.recordingToolbar);

  return window;
}
