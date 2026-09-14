import { RENDERER_ROUTES } from "@path/shared";
import { BrowserWindow, shell } from "electron";
import { join } from "node:path";
import type { CreateMainWindowOptions } from "./MainWindow";

export function createSettingsWindow({
  preloadPath,
  rendererUrl,
  rendererDirectory,
}: CreateMainWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: 940,
    height: 780,
    minWidth: 760,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f3f3f3",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    titleBarOverlay:
      process.platform === "win32"
        ? { color: "#f3f3f3", symbolColor: "#242424", height: 52 }
        : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath,
    },
  });

  window.once("ready-to-show", () => window.show());

  // External web links belong in the system browser, outside this settings renderer.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      void shell.openExternal(url);
    }

    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    const allowedUrl = rendererUrl
      ? `${rendererUrl}${RENDERER_ROUTES.settings}`
      : `file://${join(rendererDirectory, RENDERER_ROUTES.settings, "index.html")}`;

    if (!url.startsWith(allowedUrl)) event.preventDefault();
  });

  if (rendererUrl) {
    void window.loadURL(`${rendererUrl}${RENDERER_ROUTES.settings}`);
  } else {
    void window.loadFile(join(rendererDirectory, RENDERER_ROUTES.settings, "index.html"));
  }

  return window;
}
