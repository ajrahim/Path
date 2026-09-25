import { beforeEach, expect, it, vi } from "vitest";
import { IPC_CHANNELS, type AvailableAiModels } from "@path/shared";
import { registerIpcHandlers } from "../src/ipc/RegisterIpc";

const handlers = vi.hoisted(() => new Map<string, (event: unknown, input: unknown) => unknown>());

vi.mock("electron", () => ({
  app: {},
  BrowserWindow: {},
  dialog: {},
  shell: {},
  ipcMain: {
    handle: (channel: string, listener: (event: unknown, input: unknown) => unknown) => {
      handlers.set(channel, listener);
    },
  },
}));

const models: AvailableAiModels = {
  local: [
    {
      id: "writer",
      name: "Writer",
      supportedPurposes: ["text"],
      supportsEffort: false,
      sizeBytes: null,
      modifiedAt: null,
      isLoaded: false,
    },
  ],
  api: [
    {
      id: "vision",
      name: "Vision",
      provider: "openai",
      supportedPurposes: ["visual", "text"],
      supportsEffort: false,
      vendor: null,
      contextLength: null,
      pricing: null,
      isFree: false,
    },
  ],
  ollama: { status: "running", endpoint: "http://localhost:11434" },
};

const listModels = vi.fn().mockResolvedValue(models);
const updateAiModelSelection = vi.fn().mockResolvedValue({});
const textSelection = { source: "local", modelId: "writer", modelName: "Writer" };

beforeEach(() => {
  vi.clearAllMocks();
  handlers.clear();
  registerIpcHandlers({
    cliTools: {} as never,
    instructionFlows: {} as never,
    timelineImports: {} as never,
    settings: { updateAiModelSelection } as never,
    aiService: { listModels } as never,
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
    openSettingsWindow: vi.fn(),
  });
});

function select(input: unknown): Promise<unknown> {
  const handler = handlers.get(IPC_CHANNELS.settingsUpdateAiModelSelection);

  if (!handler) throw new Error("Model selection handler was not registered");

  return Promise.resolve(handler({}, input));
}

it("accepts a text-only model for writing but rejects it for visual analysis", async () => {
  await select({ purpose: "text", selection: textSelection });

  expect(updateAiModelSelection).toHaveBeenCalledWith("text", textSelection);
  updateAiModelSelection.mockClear();
  await expect(select({ purpose: "visual", selection: textSelection })).rejects.toThrow(
    "The selected visual model is not available",
  );
  expect(updateAiModelSelection).not.toHaveBeenCalled();
});

it("validates API provider identity and forwards the selected role", async () => {
  const selection = { source: "api", provider: "openai", modelId: "vision", modelName: "Vision" };

  await select({ purpose: "visual", selection });
  expect(updateAiModelSelection).toHaveBeenCalledWith("visual", selection);
  updateAiModelSelection.mockClear();
  await expect(
    select({
      purpose: "visual",
      selection: { ...selection, provider: "anthropic" },
    }),
  ).rejects.toThrow("not available");
  expect(updateAiModelSelection).not.toHaveBeenCalled();
});

it("rejects invalid purposes before discovery or persistence", async () => {
  await expect(select({ purpose: "audio", selection: textSelection })).rejects.toThrow();
  expect(listModels).not.toHaveBeenCalled();
  expect(updateAiModelSelection).not.toHaveBeenCalled();
});
