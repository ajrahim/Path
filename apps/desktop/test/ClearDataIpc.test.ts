import { beforeEach, expect, it, vi } from "vitest";
import { IPC_CHANNELS, type RecordingRuntimeState } from "@path/shared";
import { registerIpcHandlers, type IpcDependencies } from "../src/ipc/RegisterIpc";

const handlers = vi.hoisted(() => new Map<string, (event: unknown, input: unknown) => unknown>());

vi.mock("electron", () => ({
  app: {},
  BrowserWindow: {},
  dialog: {},
  shell: {},
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, input: unknown) => unknown) =>
      handlers.set(channel, handler),
  },
}));

const clearAppData = vi.fn();
const getState = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  handlers.clear();
  getState.mockReturnValue({ status: "idle" });
  registerIpcHandlers({ recording: { getState }, clearAppData } as unknown as IpcDependencies);
});

function invoke(input: unknown) {
  return handlers.get(IPC_CHANNELS.appClearData)!({}, input);
}

it("requires explicit confirmation and rejects arbitrary paths before resetting", async () => {
  for (const input of [undefined, {}, { confirmed: false }, { confirmed: true, path: "C:/" }]) {
    expect(() => invoke(input)).toThrow();
  }

  expect(clearAppData).not.toHaveBeenCalled();
  await invoke({ confirmed: true });
  expect(clearAppData).toHaveBeenCalledOnce();
});

it.each<RecordingRuntimeState["status"]>([
  "preparing",
  "recording",
  "paused",
  "stopping",
  "processing",
])("refuses reset during %s", (status) => {
  getState.mockReturnValue({ status });
  expect(() => invoke({ confirmed: true })).toThrow("Finish the current recording");
  expect(clearAppData).not.toHaveBeenCalled();
});
