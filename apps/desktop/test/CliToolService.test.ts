import { beforeEach, expect, it, vi } from "vitest";
import { CliToolService } from "../src/ai/CliToolService";
import { discoverCliModels } from "../src/ai/CliCatalog";
import { generateWithCli } from "../src/ai/CliGeneration";

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(),
  realpath: vi.fn(async (path: string) => path),
  stat: vi.fn(async () => ({ isDirectory: () => true })),
}));
vi.mock("../src/ai/CliProcess", () => ({ findCliExecutable: vi.fn(async () => "installed-cli") }));
vi.mock("../src/ai/CliCatalog", () => ({ discoverCliModels: vi.fn() }));
vi.mock("../src/ai/CliGeneration", () => ({ generateWithCli: vi.fn(async () => "# Document") }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(discoverCliModels).mockResolvedValue([
    { id: "a", name: "A", description: "", efforts: ["low", "high"] },
  ]);
});

async function setup() {
  let saved: unknown;
  const repository = {
    get: vi.fn(async () => saved),
    set: vi.fn(async (_key: string, value: unknown) => {
      saved = structuredClone(value);
    }),
  };

  const changed = vi.fn();
  const service = new CliToolService(repository as never, "work", changed);

  await service.initialize();

  return { service, repository, changed };
}

it("persists CLI selection separately, restores it, and returns to text mode on disconnect", async () => {
  const { service, repository } = await setup();

  await service.connect("codex", true);
  expect(service.get().mode).toBe("model");
  const selection = { tool: "codex" as const, model: "a", effort: "high" };

  await service.select(selection);
  const restored = new CliToolService(repository as never, "work");

  await restored.initialize();
  expect(restored.get()).toMatchObject({ mode: "cli", selection });
  await service.connect("codex", false);
  expect(service.get()).toMatchObject({ mode: "model", connected: [] });
  await expect(service.generate("Write")).rejects.toThrow("Connect and select");
});

it("rejects disconnected tools and unsupported efforts without changing saved selection", async () => {
  const { service } = await setup();

  await expect(service.select({ tool: "claude", model: "a", effort: null })).rejects.toThrow(
    "Connect",
  );
  await service.connect("claude", true);
  await expect(service.select({ tool: "claude", model: "a", effort: "ultra" })).rejects.toThrow(
    "no longer available",
  );
  expect(service.get().selection).toBeNull();
});

it("reports failed sign-in without persisting a connected state", async () => {
  const { service, repository, changed } = await setup();

  vi.mocked(discoverCliModels).mockRejectedValueOnce(new Error("Authentication required"));
  await expect(service.connect("copilot", true)).rejects.toThrow("Authentication");
  expect(repository.set).not.toHaveBeenCalled();
  expect(changed).toHaveBeenCalled();
  expect(service.get().tools.find((tool) => tool.id === "copilot")).toMatchObject({
    connected: false,
    status: "sign-in-required",
  });
});

it("only passes a context folder previously granted by the native picker", async () => {
  const { service } = await setup();

  await service.connect("muse", true);
  const selection = { tool: "muse" as const, model: "a", effort: null };

  await service.select(selection);
  await expect(service.generate("Write", "project")).rejects.toThrow(
    "Choose the context folder again",
  );
  await service.allowFolder("project");
  await expect(service.generate("Write", "project")).resolves.toBe("# Document");
  expect(generateWithCli).toHaveBeenCalledWith(
    "installed-cli",
    selection,
    "Write",
    "work",
    "project",
  );
});
