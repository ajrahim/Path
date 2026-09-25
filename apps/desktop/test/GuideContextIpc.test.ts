import { beforeEach, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "@path/shared";
import { GuideDocumentService } from "../src/documents/GuideDocumentService";
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
const describeContext = vi.fn();
const generateText = vi.fn();
const cliTools = {
  get: vi.fn(() => ({ mode: "cli" })),
  select: vi.fn(),
  connect: vi.fn(),
  allowFolder: vi.fn(async (folder) => folder),
};

beforeEach(() => {
  vi.clearAllMocks();
  handlers.clear();
  describeContext.mockResolvedValue("Image shows Save");
  generateText.mockResolvedValue("# Updated");

  const recordings = {
    get: async () => ({ title: "Recording" }),
    listTranscript: async () => [],
    listClicks: async () => [],
  };

  const documents = {
    commitRevision: async (_id: string, kind: string, markdown: string) => ({
      markdown,
      revision: { number: 1, kind, createdAt: "", characterCount: markdown.length },
    }),
    getChange: async () => ({ recordingId }),
  };

  const timelineImports = { documentEntries: async () => [] };

  registerIpcHandlers({
    cliTools: cliTools as never,
    instructionFlows: {} as never,
    settings: {} as never,
    aiService: { describeContext, generateText } as never,
    recordings: recordings as never,
    projects: {} as never,
    documents: new GuideDocumentService(
      { recordings, documents } as never,
      timelineImports,
      { describeContext, generateText },
      { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
      vi.fn(),
    ),
    assets: {} as never,
    assetDeletions: {} as never,
    rendererFlush: {} as never,
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

const request = {
  id: recordingId,
  instructions: "Help guide",
  currentMarkdown: "# Existing",
  updatePrompt: "Add details",
};

it("includes validated context in the text model update", async () => {
  const context = [{ kind: "image", name: "screen.png", dataUrl: "data:image/png;base64,YQ==" }];

  await expect(invoke(IPC_CHANNELS.guidesUpdate, { ...request, context })).resolves.toMatchObject({
    markdown: "# Updated",
  });
  expect(describeContext).toHaveBeenCalledWith(context);
  expect(generateText).toHaveBeenCalledWith(expect.stringContaining("Image shows Save"), undefined);
});
it("keeps updates without attachments compatible", async () => {
  await invoke(IPC_CHANNELS.guidesUpdate, request);
  expect(describeContext).not.toHaveBeenCalled();
  expect(generateText).toHaveBeenCalledTimes(1);
});
it("rejects invalid attachments before model requests", async () => {
  await expect(
    invoke(IPC_CHANNELS.guidesUpdate, {
      ...request,
      context: [{ kind: "image", name: "remote", dataUrl: "https://example.com/image.png" }],
    }),
  ).rejects.toThrow();
  expect(describeContext).not.toHaveBeenCalled();
  expect(generateText).not.toHaveBeenCalled();
});
it("stops the update if image analysis fails", async () => {
  describeContext.mockRejectedValueOnce(new Error("Vision unavailable"));
  await expect(
    invoke(IPC_CHANNELS.guidesUpdate, {
      ...request,
      context: [{ kind: "image", name: "screen.png", dataUrl: "data:image/png;base64,YQ==" }],
    }),
  ).rejects.toThrow("Vision unavailable");
  expect(generateText).not.toHaveBeenCalled();
});

it("validates CLI selections before reaching the service", async () => {
  await expect(
    invoke(IPC_CHANNELS.cliSelect, { tool: "unknown", model: "a", effort: null }),
  ).rejects.toThrow();
  await expect(
    invoke(IPC_CHANNELS.cliSelect, {
      tool: "codex",
      model: "a",
      effort: null,
      executable: "custom",
    }),
  ).rejects.toThrow();
  expect(cliTools.select).not.toHaveBeenCalled();
  const selection = { tool: "codex", model: "a", effort: "high" };

  await invoke(IPC_CHANNELS.cliSelect, selection);
  expect(cliTools.select).toHaveBeenCalledWith(selection);
});

it("grants only the folder returned by the native picker", async () => {
  showOpenDialog
    .mockResolvedValueOnce({ canceled: true, filePaths: [] })
    .mockResolvedValueOnce({ canceled: false, filePaths: ["chosen-folder"] });
  await expect(invoke(IPC_CHANNELS.cliChooseFolder, undefined)).resolves.toBeNull();
  expect(cliTools.allowFolder).not.toHaveBeenCalled();
  await expect(invoke(IPC_CHANNELS.cliChooseFolder, undefined)).resolves.toBe("chosen-folder");
  expect(cliTools.allowFolder).toHaveBeenCalledWith("chosen-folder");
});

it("forwards context folder alongside the document update", async () => {
  await invoke(IPC_CHANNELS.guidesUpdate, { ...request, contextFolder: "chosen-folder" });
  expect(generateText).toHaveBeenCalledWith(expect.any(String), "chosen-folder");
});
