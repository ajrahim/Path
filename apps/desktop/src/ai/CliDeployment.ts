import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CliSelection } from "@path/shared";

export interface PreparedCliDeployment {
  executable: string;
  selection: CliSelection;
  folder: string;
}

/** Build interactive invocations without changing the CLI's normal approval settings. */
export function buildDeploymentArgs(selection: CliSelection, documentPath: string): string[] {
  const prompt = `Implement the requirements in this document in the current project:\n${documentPath}\nRead the document and its referenced screenshots first. Follow the project's instructions, preserve unrelated changes, and validate your work.`;
  const args = ["--model", selection.model];

  if (selection.effort) {
    if (selection.tool === "codex") {
      args.push("-c", `model_reasoning_effort=${JSON.stringify(selection.effort)}`);
    } else {
      args.push(selection.tool === "claude" ? "--effort" : "--reasoning-effort", selection.effort);
    }
  }

  if (selection.tool === "copilot") args.push("--interactive", prompt);
  else args.push(prompt);

  return args;
}

/** The command contains only an app-created payload path; user content remains data. */
export function buildDeploymentTerminalCommand(payloadPath: string): string {
  const literalPath = payloadPath.replaceAll("'", "''");

  return [
    "$ErrorActionPreference = 'Stop'",
    `$request = [IO.File]::ReadAllText('${literalPath}') | ConvertFrom-Json`,
    "Set-Location -LiteralPath $request.folder",
    "$start = New-Object System.Diagnostics.ProcessStartInfo",
    "$start.FileName = $request.executable",
    "$start.WorkingDirectory = $request.folder",
    "$start.UseShellExecute = $false",
    "$start.Arguments = $request.commandLine",
    "$agent = [System.Diagnostics.Process]::Start($start)",
    "$agent.WaitForExit()",
  ].join("\n");
}

/** Windows native argv quoting; avoids Windows PowerShell's lossy argument rewriting. */
export function deploymentCommandLine(args: string[]): string {
  return args
    .map((arg) => `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`)
    .join(" ");
}

export async function deployToTerminal(
  deployment: PreparedCliDeployment,
  markdown: string,
  workRoot: string,
): Promise<void> {
  if (process.platform !== "win32") throw new Error("CLI deployment currently requires Windows.");
  if (!markdown.trim()) throw new Error("Generate or write a document before deploying.");

  // Retain the bundle for the interactive session; it is owned by Path's resettable data root.
  const directory = await mkdtemp(join(workRoot, "deployment-"));
  const documentPath = join(directory, "document.md");
  const images: Array<{ path: string; bytes: Buffer }> = [];
  const document = markdown.replace(
    /data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})/g,
    (_match, format: string, base64: string) => {
      const path = join(directory, `image-${images.length + 1}.${format}`).replaceAll("\\", "/");

      images.push({ path, bytes: Buffer.from(base64, "base64") });

      return path;
    },
  );

  await Promise.all([
    writeFile(documentPath, document, "utf8"),
    ...images.map((image) => writeFile(image.path, image.bytes)),
  ]);
  const payloadPath = join(directory, "launch.json");

  await writeFile(
    payloadPath,
    JSON.stringify({
      executable: deployment.executable,
      folder: deployment.folder,
      commandLine: deploymentCommandLine(buildDeploymentArgs(deployment.selection, documentPath)),
    }),
    "utf8",
  );
  const powershell = join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      powershell,
      [
        "-NoLogo",
        "-NoProfile",
        "-NoExit",
        "-EncodedCommand",
        Buffer.from(buildDeploymentTerminalCommand(payloadPath), "utf16le").toString("base64"),
      ],
      { cwd: deployment.folder, detached: true, stdio: "ignore", shell: false, windowsHide: false },
    );

    child.once("error", () => reject(new Error("The CLI terminal could not be opened.")));
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
