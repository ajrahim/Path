import { beforeEach, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "@path/shared";
import { BrowserWindow } from "electron";
import { registerIpcHandlers } from "../src/ipc/RegisterIpc";
import { applyWindowTitleBarTheme } from "../src/windows/SettingsWindow";

const handlers = vi.hoisted(() => new Map<string, (event: unknown, input: unknown) => unknown>());

vi.mock("electron", () => ({
  app: {},
  BrowserWindow: { fromWebContents: vi.fn() },
  dialog: {},
  shell: {},
  ipcMain: {
    handle: (channel: string, listener: (event: unknown, input: unknown) => unknown) =>
      handlers.set(channel, listener),
  },
}));
vi.mock("../src/windows/SettingsWindow", () => ({ applyWindowTitleBarTheme: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  handlers.clear();
  registerIpcHandlers({
    cliTools: {} as never,
    instructionFlows: {} as never,
    settings: {} as never,
    aiService: {} as never,
    recordings: {} as never,
    projects: {} as never,
    assets: {} as never,
    tray: {} as never,
    recording: {} as never,
    captureWorker: {} as never,
    regionSelector: {} as never,
    mediaServer: {} as never,
    dataDirectory: "",
    aiCredentials: {} as never,
    timelineImports: {} as never,
    openSettingsWindow: vi.fn(),
  });
});

function invoke(sender: unknown, input: unknown): void {
  const handler = handlers.get(IPC_CHANNELS.appSetTitleBarTheme);

  if (!handler) throw new Error("Title bar theme handler was not registered");

  handler({ sender }, input);
}

it("dims and restores only the sending window's caption", () => {
  const sender = {};
  const window = {} as BrowserWindow;

  vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(window);
  invoke(sender, { theme: "dark", dimmed: true });
  expect(BrowserWindow.fromWebContents).toHaveBeenCalledWith(sender);
  expect(applyWindowTitleBarTheme).toHaveBeenLastCalledWith(window, "dark", true);
  invoke(sender, { theme: "dark" });
  expect(applyWindowTitleBarTheme).toHaveBeenLastCalledWith(window, "dark", false);
});

it("rejects invalid dimming values before touching native caption controls", () => {
  expect(() => invoke({}, { theme: "dark", dimmed: "true" })).toThrow();
  expect(() => invoke({}, { theme: "dark", dimmed: true, color: "#000000" })).toThrow();
  expect(BrowserWindow.fromWebContents).not.toHaveBeenCalled();
  expect(applyWindowTitleBarTheme).not.toHaveBeenCalled();
});

it("ignores theme updates after the sending window is gone", () => {
  vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(null);
  invoke({}, { theme: "light", dimmed: false });
  expect(applyWindowTitleBarTheme).not.toHaveBeenCalled();
});
