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
const describeContext = vi.fn();
const generateText = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  handlers.clear();
  describeContext.mockResolvedValue("Image shows Save");
  generateText.mockResolvedValue("# Updated");
  registerIpcHandlers({
    instructionFlows: {} as never,
    settings: {} as never,
    aiService: { describeContext, generateText } as never,
    recordings: {
      get: async () => ({ title: "Recording" }),
      listTranscript: async () => [],
      listClicks: async () => [],
    } as never,
    projects: {} as never,
    assets: {} as never,
    tray: {} as never,
    recording: {} as never,
    captureWorker: {} as never,
    regionSelector: {} as never,
    mediaServer: {} as never,
    dataDirectory: "",
    aiCredentials: {} as never,
    timelineImports: { documentEntries: async () => [] } as never,
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
  expect(generateText).toHaveBeenCalledWith(expect.stringContaining("Image shows Save"));
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
