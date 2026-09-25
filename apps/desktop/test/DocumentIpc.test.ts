import { beforeEach, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "@path/shared";
import { registerIpcHandlers } from "../src/ipc/RegisterIpc";

const handlers = vi.hoisted(() => new Map<string, (event: unknown, input: unknown) => unknown>());

vi.mock("electron", () => ({
  app: {},
  BrowserWindow: { fromWebContents: () => null },
  dialog: {},
  shell: {},
  ipcMain: {
    handle: (channel: string, listener: (event: unknown, input: unknown) => unknown) => {
      handlers.set(channel, listener);
    },
  },
}));

const recordingId = "4a4c2a0e-9a55-4a4f-8b53-6d1c1f1f0c01";
const documents = {
  save: vi.fn(async () => ({ status: "saved" })),
  saveDraft: vi.fn(async () => ({ status: "stored" })),
  discardDraft: vi.fn(async () => ({ status: "stored" })),
  listRevisions: vi.fn(async () => ({ revisions: [], hasMore: false })),
  getRevision: vi.fn(),
  restoreRevision: vi.fn(),
};

const recordings = { delete: vi.fn(), deleteClick: vi.fn() };
const assetDeletions = { process: vi.fn(async () => undefined) };
const rendererFlush = { acknowledge: vi.fn() };
const timelineImports = { listRows: vi.fn(), locateRow: vi.fn(async () => 4) };

beforeEach(() => {
  vi.clearAllMocks();
  handlers.clear();
  registerIpcHandlers({
    cliTools: {} as never,
    instructionFlows: {} as never,
    settings: {} as never,
    aiService: {} as never,
    recordings: recordings as never,
    projects: {} as never,
    documents: documents as never,
    assets: {} as never,
    assetDeletions,
    rendererFlush,
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

function invoke(channel: string, input: unknown, senderId = 7): Promise<unknown> {
  const handler = handlers.get(channel);

  if (!handler) throw new Error(`Handler was not registered: ${channel}`);

  return new Promise((resolve) => resolve(handler({ sender: { id: senderId } }, input)));
}

it("validates save and draft requests, including their concurrency tokens", async () => {
  const save = {
    id: recordingId,
    markdown: "# Doc",
    expectedSavedRevisionNumber: null,
    draftVersion: 0,
  };

  await invoke(IPC_CHANNELS.guidesSaveDocument, save);
  expect(documents.save).toHaveBeenCalledWith(save);

  for (const invalid of [
    { ...save, expectedSavedRevisionNumber: 0 },
    { ...save, draftVersion: -1 },
    { ...save, draftVersion: 1.5 },
    { ...save, markdown: "x".repeat(10_000_001) },
    { ...save, id: "not-a-uuid" },
    { ...save, extra: true },
  ]) {
    await expect(invoke(IPC_CHANNELS.guidesSaveDocument, invalid)).rejects.toThrow();
  }

  await expect(
    invoke(IPC_CHANNELS.guidesSaveDraft, {
      id: recordingId,
      markdown: "#",
      expectedDraftVersion: -1,
    }),
  ).rejects.toThrow();
  await expect(
    invoke(IPC_CHANNELS.guidesDiscardDraft, { id: recordingId, expectedDraftVersion: 3 }),
  ).resolves.toEqual({ status: "stored" });
  expect(documents.save).toHaveBeenCalledOnce();
  expect(documents.saveDraft).not.toHaveBeenCalled();
});

it("validates revision paging and restore requests", async () => {
  await invoke(IPC_CHANNELS.guidesListRevisions, { id: recordingId, beforeNumber: 10, limit: 50 });
  expect(documents.listRevisions).toHaveBeenCalledWith({
    id: recordingId,
    beforeNumber: 10,
    limit: 50,
  });

  await expect(
    invoke(IPC_CHANNELS.guidesListRevisions, { id: recordingId, limit: 101 }),
  ).rejects.toThrow();
  await expect(
    invoke(IPC_CHANNELS.guidesGetRevision, { id: recordingId, number: 0 }),
  ).rejects.toThrow();
  await expect(
    invoke(IPC_CHANNELS.guidesRestoreRevision, { id: recordingId, number: 2, replaced: "" }),
  ).rejects.toThrow();
  expect(documents.restoreRevision).not.toHaveBeenCalled();
});

it("bounds timeline pages and forwards locate requests", async () => {
  await expect(
    invoke(IPC_CHANNELS.recordingsListTimelineImportRows, {
      recordingId,
      kind: "log",
      start: 0,
      limit: 501,
    }),
  ).rejects.toThrow();
  await expect(
    invoke(IPC_CHANNELS.recordingsListTimelineImportRows, {
      recordingId,
      kind: "log",
      start: -1,
      limit: 10,
    }),
  ).rejects.toThrow();
  expect(timelineImports.listRows).not.toHaveBeenCalled();

  await expect(
    invoke(IPC_CHANNELS.recordingsLocateTimelineImportRow, {
      recordingId,
      kind: "element",
      timestampMs: 1_500,
      query: " save ",
    }),
  ).resolves.toEqual({ index: 4 });
  expect(timelineImports.locateRow).toHaveBeenCalledWith(recordingId, "element", 1_500, "save");
});

it("deletes rows before files and never takes a path from the renderer", async () => {
  await invoke(IPC_CHANNELS.recordingsDelete, { id: recordingId });
  expect(recordings.delete).toHaveBeenCalledWith(recordingId);
  expect(assetDeletions.process).toHaveBeenCalledOnce();

  await expect(
    invoke(IPC_CHANNELS.recordingsDelete, { id: recordingId, path: "C:/Windows" }),
  ).rejects.toThrow();
});

it("acknowledges a flush only for the window that sent it", async () => {
  await invoke(IPC_CHANNELS.appFlushComplete, { requestId: 3 }, 42);
  expect(rendererFlush.acknowledge).toHaveBeenCalledWith(42, 3);
  await expect(invoke(IPC_CHANNELS.appFlushComplete, { requestId: 0 })).rejects.toThrow();
});
