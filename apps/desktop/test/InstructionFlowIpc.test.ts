import { beforeEach, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "@path/shared";
import { registerIpcHandlers } from "../src/ipc/RegisterIpc";

const handlers = vi.hoisted(() => new Map<string, (event: unknown, input: unknown) => unknown>());

vi.mock("electron", () => ({
  app: {},
  BrowserWindow: {},
  dialog: {},
  shell: {},
  ipcMain: {
    handle: (channel: string, listener: (event: unknown, input: unknown) => unknown) =>
      handlers.set(channel, listener),
  },
}));

const instructionFlows = {
  get: vi.fn(),
  select: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  handlers.clear();
  registerIpcHandlers({
    cliTools: {} as never,
    instructionFlows: instructionFlows as never,
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

function invoke(channel: string, input?: unknown): Promise<unknown> {
  const handler = handlers.get(channel);

  if (!handler) throw new Error(`Handler was not registered: ${channel}`);

  return new Promise((resolve) => resolve(handler({}, input)));
}

it("forwards normalized prompt mutations through the validated bridge", async () => {
  instructionFlows.save.mockResolvedValue({ revision: 3 });
  await expect(
    invoke(IPC_CHANNELS.instructionFlowsSave, {
      name: " My prompt ",
      instructions: " My instructions ",
      icon: "bug",
      select: true,
    }),
  ).resolves.toEqual({ revision: 3 });
  expect(instructionFlows.save).toHaveBeenCalledWith({
    name: "My prompt",
    instructions: "My instructions",
    icon: "bug",
    select: true,
  });
  await invoke(IPC_CHANNELS.instructionFlowsSelect, { id: "spec-document" });
  expect(instructionFlows.select).toHaveBeenCalledWith({ id: "spec-document" });
  await invoke(IPC_CHANNELS.instructionFlowsRemove, { id: "custom-example" });
  expect(instructionFlows.remove).toHaveBeenCalledWith({ id: "custom-example" });
});

it("rejects invalid icons, excessive text, and unknown fields before touching the service", async () => {
  const draft = { name: "My prompt", instructions: "Instructions", icon: "bug" };

  for (const input of [
    { ...draft, icon: "unknown" },
    { ...draft, instructions: "x".repeat(10_001) },
    { ...draft, revision: 9 },
  ]) {
    await expect(invoke(IPC_CHANNELS.instructionFlowsSave, input)).rejects.toThrow();
  }

  await expect(
    invoke(IPC_CHANNELS.instructionFlowsSelect, { id: "help-guide", customFlows: [] }),
  ).rejects.toThrow();
  expect(instructionFlows.save).not.toHaveBeenCalled();
  expect(instructionFlows.select).not.toHaveBeenCalled();
});

it("exposes no legacy prompt migration channel", () => {
  expect([...handlers.keys()].some((channel) => channel.includes("migrate"))).toBe(false);
});
