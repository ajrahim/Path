import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { CliToolId } from "@path/shared";

const MAX_PROCESS_OUTPUT = 24 * 1024 * 1024;
const DISCOVERY_TIMEOUT_MS = 20_000;
const activeChildren = new Set<ChildProcessWithoutNullStreams>();

export const CLI_GENERATION_TIMEOUT_MS = 240_000;

export async function findCliExecutable(tool: CliToolId): Promise<string | null> {
  const directories = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const home = homedir();

  directories.push(join(home, ".local", "bin"), join(home, ".bun", "bin"));
  const candidates = directories.map((dir) =>
    join(dir, process.platform === "win32" ? `${tool}.exe` : tool),
  );

  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA;
    const roaming = process.env.APPDATA;

    if (tool === "copilot" && roaming) {
      candidates.push(
        join(
          roaming,
          "npm",
          "node_modules",
          "@github",
          "copilot",
          "node_modules",
          `@github/copilot-win32-${process.arch}`,
          "copilot.exe",
        ),
      );
    }

    if (tool === "muse" && local) {
      const dir = join(local, "Programs", "muse");
      const files = await readdir(dir).catch(() => []);

      candidates.push(
        ...files
          .filter((name) => /^muse-bin-[\d.]+-R[\d.]+\.exe$/.test(name))
          .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
          .map((name) => join(dir, name)),
      );
    }

    if (tool === "codex" && local) {
      const dir = join(local, "OpenAI", "Codex", "bin");
      const versions = await readdir(dir).catch(() => []);

      candidates.push(...versions.map((version) => join(dir, version, "codex.exe")));
    }
  }

  for (const candidate of candidates) {
    try {
      await access(candidate);

      return candidate;
    } catch {
      /* Try the next installed location. */
    }
  }

  return null;
}

export function startCli(
  executable: string,
  args: string[],
  cwd: string,
): ChildProcessWithoutNullStreams {
  const child = spawn(executable, args, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    shell: false,
  });

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  activeChildren.add(child);
  child.once("close", () => activeChildren.delete(child));

  return child;
}

export function stopCliProcesses(): void {
  for (const child of activeChildren) child.kill();
  activeChildren.clear();
}

export async function runCli(
  executable: string,
  args: string[],
  cwd: string,
  input = "",
  timeout = DISCOVERY_TIMEOUT_MS,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = startCli(executable, args, cwd);
    let stdout = "",
      stderr = "",
      settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        child.kill();
        reject(error);
      } else {
        resolve(stdout);
      }
    };

    const timer = setTimeout(() => finish(new Error("CLI timed out")), timeout);

    child.on("error", () => finish(new Error("Could not start CLI")));
    child.stdout.on("data", (data) => {
      stdout += String(data);
      if (stdout.length > MAX_PROCESS_OUTPUT) finish(new Error("CLI output exceeded the limit"));
    });
    child.stderr.on("data", (data) => {
      stderr = (stderr + String(data)).slice(-4000);
    });
    child.stdin.on("error", () => {});
    child.on("close", (code) =>
      finish(
        code === 0
          ? undefined
          : new Error(
              /auth|login|not.logged|sign.in|credential/i.test(stderr + stdout)
                ? "CLI sign-in required"
                : "CLI request failed",
            ),
      ),
    );
    child.stdin.end(input);
  });
}

/** Bounded JSON-lines transport. Child processes never receive shell-interpolated arguments. */
export class CliRpc {
  private child: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private pending = new Map<
    number | string,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private buffer = "";
  private received = 0;
  onNotification: (message: Record<string, unknown>) => void = () => {};
  constructor(executable: string, args: string[], cwd: string) {
    this.child = startCli(executable, args, cwd);
    this.child.stderr.on("data", () => {});
    this.child.stdin.on("error", () => {});
    this.child.on("error", () => this.close());
    this.child.on("close", () => this.close());
    this.child.stdout.on("data", (data) => {
      this.buffer += String(data);
      this.received += String(data).length;
      if (this.received > MAX_PROCESS_OUTPUT) {
        this.close();

        return;
      }

      let end: number;

      while ((end = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, end);

        this.buffer = this.buffer.slice(end + 1);
        try {
          this.receive(object(JSON.parse(line)));
        } catch {
          /* Ignore non-protocol startup output. */
        }
      }
    });
  }
  private receive(message: Record<string, unknown>) {
    const response = object(message.response);
    const id = message.type === "control_response" ? response.request_id : message.id;
    const pending =
      typeof id === "string" || typeof id === "number" ? this.pending.get(id) : undefined;

    if (pending && !message.method) {
      this.pending.delete(id as string | number);
      clearTimeout(pending.timer);
      if (message.error || response.subtype === "error") {
        pending.reject(
          new Error(
            String(object(message.error).message ?? response.error ?? "CLI request failed"),
          ),
        );
      } else {
        pending.resolve(message.type === "control_response" ? response.response : message.result);
      }
    } else if (message.method === "session/request_permission" && message.id !== undefined) {
      this.send({ jsonrpc: "2.0", id: message.id, result: { outcome: { outcome: "cancelled" } } });
    } else {
      this.onNotification(message);
    }
  }
  send(message: unknown) {
    if (!this.child.killed) this.child.stdin.write(JSON.stringify(message) + "\n");
  }
  request(method: string, params: unknown, timeout = DISCOVERY_TIMEOUT_MS): Promise<unknown> {
    const id = ++this.sequence;

    return this.wait(id, { jsonrpc: "2.0", id, method, params }, timeout);
  }
  initializeClaude(): Promise<unknown> {
    return this.wait(
      "initialize",
      { type: "control_request", request_id: "initialize", request: { subtype: "initialize" } },
      DISCOVERY_TIMEOUT_MS,
    );
  }
  private wait(id: string | number, message: unknown, timeout: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("CLI discovery timed out"));
        this.close();
      }, timeout);

      this.pending.set(id, { resolve, reject, timer });
      this.send(message);
    });
  }
  close() {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("CLI connection closed"));
    }

    this.pending.clear();
    if (!this.child.killed) this.child.kill();
  }
}

export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function strings(value: unknown): string[] {
  return array(value).filter((v): v is string => typeof v === "string");
}
