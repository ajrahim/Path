import { RENDERER_ROUTES } from "@path/shared";
import { BrowserWindow, nativeImage, shell } from "electron";
import { join } from "node:path";
import type { CreateMainWindowOptions } from "./MainWindow";

const TITLE_BAR_HEIGHT = 52;
const THEME_STORAGE_KEY = "path.theme";
const windowsWithAppliedTitleBarTheme = new WeakSet<BrowserWindow>();
const TITLE_BAR_COLORS = {
  light: { color: "#f3f4f6", symbolColor: "#242b35" },
  dark: { color: "#181b20", symbolColor: "#e7ebf0" },
};

// Match the renderer's modal backdrop: 40% black over the caption and its glyphs.
const DIMMED_TITLE_BAR_COLORS = {
  light: { color: "#929294", symbolColor: "#161a20" },
  dark: { color: "#0e1013", symbolColor: "#8b8d90" },
};

/** Windows caption glyphs are a native overlay, so renderer theme tokens cannot recolor them. */
export function applyWindowTitleBarTheme(
  window: BrowserWindow,
  theme: "light" | "dark",
  dimmed = false,
): void {
  if (process.platform !== "win32" || window.isDestroyed()) return;

  const colors = dimmed ? DIMMED_TITLE_BAR_COLORS : TITLE_BAR_COLORS;

  window.setTitleBarOverlay({
    ...colors[theme],
    height: TITLE_BAR_HEIGHT,
  });
  windowsWithAppliedTitleBarTheme.add(window);
}

export function createSettingsWindow(
  { preloadPath, rendererUrl, rendererDirectory, iconPath }: CreateMainWindowOptions,
  section?: string,
): BrowserWindow {
  const windowIcon = iconPath ? nativeImage.createFromPath(iconPath) : undefined;
  const window = new BrowserWindow({
    width: 940,
    height: 780,
    minWidth: 760,
    minHeight: 620,
    show: false,
    icon: windowIcon && !windowIcon.isEmpty() ? windowIcon : iconPath,
    autoHideMenuBar: true,
    backgroundColor: "#f3f4f6",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    titleBarOverlay:
      process.platform === "win32"
        ? { color: "#f3f4f6", symbolColor: "#242b35", height: TITLE_BAR_HEIGHT }
        : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath,
    },
  });

  if (windowIcon && !windowIcon.isEmpty()) {
    window.setIcon(windowIcon);
  }

  let themeApplied = process.platform !== "win32";
  let readyToShow = false;

  function showWhenReady(): void {
    if (themeApplied && readyToShow && !window.isDestroyed() && !window.isVisible()) {
      window.show();
    }
  }

  window.webContents.once("did-finish-load", () => {
    void window.webContents
      .executeJavaScript(`localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})`)
      .then((storedTheme: unknown) => {
        // The renderer may already have applied a newer theme or opened a modal.
        if (windowsWithAppliedTitleBarTheme.has(window)) return;

        applyWindowTitleBarTheme(window, storedTheme === "dark" ? "dark" : "light");
      })
      .finally(() => {
        themeApplied = true;
        showWhenReady();
      });
  });
  window.once("ready-to-show", () => {
    readyToShow = true;
    showWhenReady();
  });

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

  const hash = section ? `#${section}` : "";

  if (rendererUrl) {
    void window.loadURL(`${rendererUrl}${RENDERER_ROUTES.settings}${hash}`);
  } else {
    void window.loadFile(join(rendererDirectory, RENDERER_ROUTES.settings, "index.html"), {
      hash,
    });
  }

  return window;
}
