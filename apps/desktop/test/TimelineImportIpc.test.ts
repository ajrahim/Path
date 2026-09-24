import { beforeEach, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "@path/shared";
import { registerIpcHandlers } from "../src/ipc/RegisterIpc";

const handlers = vi.hoisted(() => new Map<string, (event: unknown, input: unknown) => unknown>());
const showOpenDialog = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({
  app: {},
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showOpenDialog },
  shell: {},
  ipcMain: {
    handle: (channel: string, listener: (event: unknown, input: unknown) => unknown) => {
      handlers.set(channel, listener);
    },
  },
}));

const recordingId = "4a4c2a0e-9a55-4a4f-8b53-6d1c1f1f0c01";
const timelineImports = {
  list: vi.fn(),
  importFile: vi.fn(),
  updateOffset: vi.fn(),
  remove: vi.fn(),
};

const updateTimelineImports = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  handlers.clear();
  registerIpcHandlers({
    instructionFlows: {} as never,
    settings: { updateTimelineImports } as never,
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
    timelineImports: timelineImports as never,
    openSettingsWindow: vi.fn(),
  });
});

function invoke(channel: string, input: unknown): Promise<unknown> {
  const handler = handlers.get(channel);

  if (!handler) throw new Error(`Handler was not registered: ${channel}`);

  // Electron reports a synchronous handler throw as a rejected invoke.
  return new Promise((resolve) => resolve(handler({ sender: {} }, input)));
}

it("opens the file dialog only through the import service for a valid request", async () => {
  showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ["C:/logs/app.log"] });
  timelineImports.importFile.mockImplementation(
    async (_id: string, _kind: string, chooseFile: () => Promise<string | null>) => ({
      status: "chosen",
      path: await chooseFile(),
    }),
  );

  await expect(
    invoke(IPC_CHANNELS.recordingsImportTimelineFile, { recordingId, kind: "element" }),
  ).resolves.toEqual({ status: "chosen", path: "C:/logs/app.log" });
  expect(timelineImports.importFile).toHaveBeenCalledWith(
    recordingId,
    "element",
    expect.any(Function),
  );
  expect(showOpenDialog.mock.calls[0]?.[0]).toMatchObject({ properties: ["openFile"] });
});

it("rejects renderer-supplied paths, unknown kinds, and invalid recording IDs", async () => {
  await expect(
    invoke(IPC_CHANNELS.recordingsImportTimelineFile, {
      recordingId,
      kind: "log",
      path: "C:/secrets.txt",
    }),
  ).rejects.toThrow();
  await expect(
    invoke(IPC_CHANNELS.recordingsImportTimelineFile, { recordingId, kind: "video" }),
  ).rejects.toThrow();
  await expect(
    invoke(IPC_CHANNELS.recordingsRemoveTimelineImport, { recordingId: "../rec", kind: "log" }),
  ).rejects.toThrow();
  expect(timelineImports.importFile).not.toHaveBeenCalled();
  expect(timelineImports.remove).not.toHaveBeenCalled();
});

it("bounds offsets to whole milliseconds within a day", async () => {
  await invoke(IPC_CHANNELS.recordingsUpdateTimelineImportOffset, {
    recordingId,
    kind: "log",
    offsetMs: -86_400_000,
  });

  expect(timelineImports.updateOffset).toHaveBeenCalledWith(recordingId, "log", -86_400_000);

  for (const offsetMs of [86_400_001, 1.5, Number.NaN]) {
    await expect(
      invoke(IPC_CHANNELS.recordingsUpdateTimelineImportOffset, {
        recordingId,
        kind: "log",
        offsetMs,
      }),
    ).rejects.toThrow();
  }

  expect(timelineImports.updateOffset).toHaveBeenCalledTimes(1);
});

it("accepts import size limits from 1 to 100 whole megabytes", async () => {
  await invoke(IPC_CHANNELS.settingsUpdateTimelineImports, { maxFileSizeMb: 100 });

  expect(updateTimelineImports).toHaveBeenCalledWith({ maxFileSizeMb: 100 });

  for (const maxFileSizeMb of [0, 101, 10.5]) {
    await expect(
      invoke(IPC_CHANNELS.settingsUpdateTimelineImports, { maxFileSizeMb }),
    ).rejects.toThrow();
  }

  expect(updateTimelineImports).toHaveBeenCalledTimes(1);
});
