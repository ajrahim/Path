import { describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import {
  createCaptureWorker,
  createRecorderPopover,
  createRecordingToolbar,
} from "../src/windows/SupportWindows";

vi.mock("electron", () => ({
  BrowserWindow: vi.fn(function () {
    return {
      setContentProtection: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      setVisibleOnAllWorkspaces: vi.fn(),
      on: vi.fn(),
      loadURL: vi.fn(),
      loadFile: vi.fn(),
    };
  }),
}));

describe("recording control capture protection", () => {
  it.each([
    ["toolbar", createRecordingToolbar],
    ["tray recorder", createRecorderPopover],
  ] as const)("protects the %s before loading its renderer", (_name, createWindow) => {
    const window = createWindow({
      preloadPath: "preload.cjs",
      rendererDirectory: "renderer",
      rendererUrl: "http://localhost:3000",
    });

    expect(window.setContentProtection).toHaveBeenCalledWith(true);

    // The first renderer frame must already be protected, not just the final window state.
    expect(vi.mocked(window.setContentProtection).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(window.loadURL).mock.invocationCallOrder[0]!,
    );
  });
});

describe("direct renderer page loading", () => {
  it.each([
    ["CapturePage", createCaptureWorker],
    ["RecorderPage", createRecorderPopover],
    ["RecordingToolbarPage", createRecordingToolbar],
  ] as const)("opens %s in development and the static export", (page, createWindow) => {
    const developmentWindow = createWindow({
      preloadPath: "preload.cjs",
      rendererDirectory: "renderer",
      rendererUrl: "http://localhost:3000",
    });

    expect(developmentWindow.loadURL).toHaveBeenCalledWith(`http://localhost:3000/${page}/`);

    // Packaged windows must target the same case-sensitive directory produced by Next.
    const exportedWindow = createWindow({
      preloadPath: "preload.cjs",
      rendererDirectory: "renderer",
    });

    expect(exportedWindow.loadFile).toHaveBeenCalledWith(join("renderer", page, "index.html"));
  });
});
