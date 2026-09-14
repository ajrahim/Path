import { describe, expect, it, vi } from "vitest";
import { BrowserWindow } from "electron";
import { createMainWindow } from "../src/windows/MainWindow";

vi.mock("electron", () => ({
  BrowserWindow: vi.fn(function () {
    return {
      once: vi.fn(),
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      webContents: { setWindowOpenHandler: vi.fn(), on: vi.fn() },
    };
  }),
  shell: { openExternal: vi.fn() },
}));

describe("main window appearance", () => {
  it("matches Windows caption controls to the blue renderer title bar", () => {
    createMainWindow({
      preloadPath: "preload.cjs",
      rendererDirectory: "renderer",
      rendererUrl: "http://localhost:3001",
    });

    const options = vi.mocked(BrowserWindow).mock.calls[0]?.[0];

    expect(options?.titleBarStyle).toBe(process.platform === "darwin" ? "hiddenInset" : "hidden");
    expect(options?.titleBarOverlay).toEqual(
      process.platform === "win32"
        ? { color: "#185abd", symbolColor: "#ffffff", height: 52 }
        : undefined,
    );
  });
});
