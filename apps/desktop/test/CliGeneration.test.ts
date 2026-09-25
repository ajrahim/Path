import { beforeEach, expect, it, vi } from "vitest";
import { join, resolve } from "node:path";
import { generateWithCli } from "../src/ai/CliGeneration";
import type * as CliProcessModule from "../src/ai/CliProcess";
import { runCli } from "../src/ai/CliProcess";
import { rm } from "node:fs/promises";

vi.mock("node:fs/promises", () => ({
  mkdtemp: vi.fn(async (prefix: string) => `${prefix}test`),
  readFile: vi.fn(async () => "# Codex"),
  writeFile: vi.fn(),
  rm: vi.fn(),
}));
vi.mock("../src/ai/CliProcess", async (importOriginal) => ({
  ...(await importOriginal<typeof CliProcessModule>()),
  runCli: vi.fn(),
}));
beforeEach(() => vi.clearAllMocks());
const workRoot = resolve("cli-test-work");

it("runs Codex with the selected effort and read-only workspace, then removes its own scratch directory", async () => {
  await expect(
    generateWithCli(
      "codex",
      { tool: "codex", model: "a", effort: "high" },
      "Write",
      workRoot,
      "chosen-folder",
    ),
  ).resolves.toBe("# Codex");
  const call = vi.mocked(runCli).mock.calls[0]!;

  expect(call[1]).toEqual(
    expect.arrayContaining([
      "--sandbox",
      "read-only",
      "--model",
      "a",
      'model_reasoning_effort="high"',
    ]),
  );
  expect(call[2]).toBe("chosen-folder");
  expect(call[3]).toContain("Write");
  expect(rm).toHaveBeenCalledWith(join(workRoot, "request-test"), { recursive: true, force: true });
});

it("parses Claude output and preserves failures instead of returning a false success", async () => {
  vi.mocked(runCli)
    .mockResolvedValueOnce('{"result":"# Claude"}')
    .mockResolvedValueOnce('{"is_error":true}');
  const selection = { tool: "claude" as const, model: "opus", effort: "high" };

  await expect(generateWithCli("claude", selection, "Write", workRoot)).resolves.toBe("# Claude");
  expect(vi.mocked(runCli).mock.calls[0]![1]).toEqual(
    expect.arrayContaining(["--tools", "Read,Glob,Grep", "--effort", "high"]),
  );
  await expect(generateWithCli("claude", selection, "Write", workRoot)).rejects.toThrow(
    "could not complete",
  );
});

it("uses only Muse's completed document event and disables mutation tools", async () => {
  vi.mocked(runCli).mockResolvedValue(
    'startup\n{"payload_type":"run.terminal.completed","payload":{"text":"# Muse"}}\n',
  );
  await expect(
    generateWithCli("muse", { tool: "muse", model: "muse-spark", effort: null }, "Write", workRoot),
  ).resolves.toBe("# Muse");
  expect(vi.mocked(runCli).mock.calls[0]![1]).toEqual(
    expect.arrayContaining(["--disable-write", "--disable-shell", "--prompt-file"]),
  );
});
