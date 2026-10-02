import { EventEmitter } from "node:events";
import type * as ChildProcess from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  buildDeploymentArgs,
  buildDeploymentTerminalCommand,
  deployToTerminal,
  deploymentCommandLine,
} from "../src/ai/CliDeployment";

const launch = vi.hoisted(() => ({ spawn: vi.fn() }));

vi.mock("node:child_process", () => ({ spawn: launch.spawn }));
const directories: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

it.each([
  ["codex", ["-c", 'model_reasoning_effort="high"']],
  ["claude", ["--effort", "high"]],
  ["copilot", ["--reasoning-effort", "high"]],
  ["muse", ["--reasoning-effort", "high"]],
] as const)(
  "builds an interactive %s request using the selected model and reasoning",
  (tool, expected) => {
    const args = buildDeploymentArgs(
      { tool, model: "model-a", effort: "high" },
      "C:/Task Files/document.md",
    );

    expect(args.slice(0, 4)).toEqual(["--model", "model-a", ...expected]);
    expect(args.at(-1)).toContain("C:/Task Files/document.md");
    expect(args).not.toContain("--print");
    expect(args).not.toContain("--yolo");
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    if (tool === "copilot") expect(args.at(-2)).toBe("--interactive");
  },
);

it("quotes only the payload filename and keeps the CLI arguments out of executable shell text", () => {
  const command = buildDeploymentTerminalCommand("C:/O'Brien/$task`/launch.json");

  expect(command).toContain("ReadAllText('C:/O''Brien/$task`/launch.json')");
  expect(command).toContain("$start.UseShellExecute = $false");
  expect(command).not.toContain("Invoke-Expression");
});

it.skipIf(process.platform !== "win32")(
  "passes the model, reasoning, and prompt intact through real PowerShell",
  async () => {
    const nativeProcess = await vi.importActual<typeof ChildProcess>("node:child_process");
    const directory = await mkdtemp(join(tmpdir(), "path deployment ' $ test-"));

    directories.push(directory);
    const echo = join(directory, "arguments.cjs");
    const payload = join(directory, "launch.json");
    const args = buildDeploymentArgs(
      { tool: "codex", model: "model-a", effort: "high" },
      join(directory, "document.md"),
    );

    await writeFile(echo, "process.stdout.write(JSON.stringify(process.argv.slice(2)));");
    await writeFile(
      payload,
      JSON.stringify({
        executable: process.execPath,
        folder: directory,
        commandLine: deploymentCommandLine([echo, ...args]),
      }),
    );
    const result = nativeProcess.spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(buildDeploymentTerminalCommand(payload), "utf16le").toString("base64"),
      ],
      { encoding: "utf8", windowsHide: true, shell: false, timeout: 10_000 },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(args);
  },
);

it.skipIf(process.platform !== "win32")(
  "bundles documents and images as data and opens a visible interactive terminal",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "path-deployment-test-"));

    directories.push(directory);
    launch.spawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { unref: vi.fn() });

      queueMicrotask(() => child.emit("spawn"));

      return child;
    });
    const markdown =
      "# Task\n\n$(Write-Output secret); & extra\n\n![Reference](data:image/png;base64,aGVsbG8=)";

    await deployToTerminal(
      {
        executable: "C:/Tools/codex.exe",
        folder: directory,
        selection: { tool: "codex", model: "a", effort: "high" },
      },
      markdown,
      directory,
    );
    const bundle = join(directory, (await readdir(directory))[0]);
    const document = await readFile(join(bundle, "document.md"), "utf8");
    const payload = JSON.parse(await readFile(join(bundle, "launch.json"), "utf8"));

    expect(document).toContain("$(Write-Output secret); & extra");
    expect(document).not.toContain("base64");
    expect(await readFile(join(bundle, "image-1.png"), "utf8")).toBe("hello");
    expect(payload.folder).toBe(directory);
    const [, args, options] = launch.spawn.mock.calls[0];

    expect(options).toMatchObject({
      shell: false,
      windowsHide: false,
      detached: true,
      cwd: directory,
    });
    expect(args).toContain("-NoExit");
    expect(Buffer.from(args.at(-1), "base64").toString("utf16le")).not.toContain(
      "Write-Output secret",
    );
  },
);
