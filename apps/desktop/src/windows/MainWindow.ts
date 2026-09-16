import { BrowserWindow, shell } from "electron";
import { join } from "node:path";

export interface CreateMainWindowOptions {
  preloadPath: string;
  rendererUrl?: string;
  rendererDirectory: string;
  iconPath?: string;
}

export function createMainWindow({
  preloadPath,
  rendererUrl,
  rendererDirectory,
  iconPath,
}: CreateMainWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: 1480,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    icon: iconPath,
    autoHideMenuBar: true,
    backgroundColor: "#f3f3f3",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    titleBarOverlay:
      process.platform === "win32"
        ? { color: "#185abd", symbolColor: "#ffffff", height: 52 }
        : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath,
    },
  });

  window.once("ready-to-show", () => window.show());

  // Open web links in the system browser instead of giving a new window the desktop bridge.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      void shell.openExternal(url);
    }

    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    const allowedUrl = rendererUrl ?? `file://${join(rendererDirectory, "index.html")}`;

    if (!url.startsWith(allowedUrl)) {
      event.preventDefault();
    }
  });

  if (rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(join(rendererDirectory, "index.html"));
  }

  return window;
}
