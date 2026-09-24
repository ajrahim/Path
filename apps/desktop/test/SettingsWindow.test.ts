import { describe, expect, it, vi } from "vitest";
import { BrowserWindow } from "electron";
import { applyWindowTitleBarTheme, createSettingsWindow } from "../src/windows/SettingsWindow";

const windowEvents = new Map<string, () => void>();
const contentsEvents = new Map<string, () => void>();

vi.mock("electron", () => ({
  BrowserWindow: vi.fn(function () {
    return {
      isDestroyed: () => false,
      isVisible: () => false,
      once: vi.fn((event: string, listener: () => void) => windowEvents.set(event, listener)),
      on: vi.fn(),
      show: vi.fn(),
      setIcon: vi.fn(),
      setTitleBarOverlay: vi.fn(),
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      webContents: {
        once: vi.fn((event: string, listener: () => void) => contentsEvents.set(event, listener)),
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        executeJavaScript: vi.fn().mockResolvedValue("dark"),
      },
    };
  }),
  nativeImage: {
    createFromPath: vi.fn(() => ({ isEmpty: () => true })),
  },
  shell: { openExternal: vi.fn() },
}));

describe("settings window caption theme", () => {
  it("applies the saved dark theme before the window is shown", async () => {
    windowEvents.clear();
    contentsEvents.clear();

    const window = createSettingsWindow({
      preloadPath: "preload.cjs",
      rendererDirectory: "renderer",
      rendererUrl: "http://localhost:3000",
    });

    expect(vi.mocked(BrowserWindow).mock.calls[0]?.[0]?.titleBarOverlay).toEqual(
      process.platform === "win32"
        ? { color: "#f3f4f6", symbolColor: "#242b35", height: 52 }
        : undefined,
    );

    windowEvents.get("ready-to-show")?.();
    expect(window.show).not.toHaveBeenCalled();

    contentsEvents.get("did-finish-load")?.();
    await vi.waitFor(() => expect(window.show).toHaveBeenCalledOnce());

    if (process.platform === "win32") {
      expect(window.setTitleBarOverlay).toHaveBeenCalledWith({
        color: "#181b20",
        symbolColor: "#e7ebf0",
        height: 52,
      });
      expect(window.setTitleBarOverlay.mock.invocationCallOrder[0]).toBeLessThan(
        window.show.mock.invocationCallOrder[0]!,
      );
    }
  });

  it("recolors caption controls for the active theme", () => {
    const window = {
      isDestroyed: () => false,
      setTitleBarOverlay: vi.fn(),
    } as unknown as BrowserWindow;

    applyWindowTitleBarTheme(window, "dark");
    applyWindowTitleBarTheme(window, "light");

    if (process.platform !== "win32") {
      expect(window.setTitleBarOverlay).not.toHaveBeenCalled();

      return;
    }

    expect(window.setTitleBarOverlay).toHaveBeenNthCalledWith(1, {
      color: "#181b20",
      symbolColor: "#e7ebf0",
      height: 52,
    });
    expect(window.setTitleBarOverlay).toHaveBeenNthCalledWith(2, {
      color: "#f3f4f6",
      symbolColor: "#242b35",
      height: 52,
    });
  });

  it.each([
    {
      theme: "light" as const,
      normal: { color: "#f3f4f6", symbolColor: "#242b35" },
      dimmed: { color: "#929294", symbolColor: "#161a20" },
    },
    {
      theme: "dark" as const,
      normal: { color: "#181b20", symbolColor: "#e7ebf0" },
      dimmed: { color: "#0e1013", symbolColor: "#8b8d90" },
    },
  ])("dims and restores the $theme caption with the modal", ({ theme, normal, dimmed }) => {
    const window = {
      isDestroyed: () => false,
      setTitleBarOverlay: vi.fn(),
    } as unknown as BrowserWindow;

    applyWindowTitleBarTheme(window, theme, true);
    applyWindowTitleBarTheme(window, theme, false);

    if (process.platform !== "win32") {
      expect(window.setTitleBarOverlay).not.toHaveBeenCalled();

      return;
    }

    expect(window.setTitleBarOverlay).toHaveBeenNthCalledWith(1, { ...dimmed, height: 52 });
    expect(window.setTitleBarOverlay).toHaveBeenNthCalledWith(2, { ...normal, height: 52 });
  });

  it("keeps a newer modal caption state when the initial saved theme resolves late", async () => {
    const window = createSettingsWindow({
      preloadPath: "preload.cjs",
      rendererDirectory: "renderer",
      rendererUrl: "http://localhost:3000",
    });

    let finishSavedThemeRead: (theme: string) => void = () => undefined;

    vi.mocked(window.webContents.executeJavaScript).mockReturnValueOnce(
      new Promise<string>((resolve) => {
        finishSavedThemeRead = resolve;
      }),
    );
    contentsEvents.get("did-finish-load")?.();
    applyWindowTitleBarTheme(window, "light", true);
    finishSavedThemeRead("dark");
    windowEvents.get("ready-to-show")?.();
    await vi.waitFor(() => expect(window.show).toHaveBeenCalledOnce());

    if (process.platform === "win32") {
      expect(window.setTitleBarOverlay).toHaveBeenCalledExactlyOnceWith({
        color: "#929294",
        symbolColor: "#161a20",
        height: 52,
      });
    }
  });
});
