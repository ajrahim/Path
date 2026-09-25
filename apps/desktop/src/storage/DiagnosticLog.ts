import { appendFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Retention for application diagnostics only. Imported evidence and document history are user
 * data stored in SQLite and are never subject to this policy.
 */
export const DIAGNOSTIC_LOG_POLICY = {
  maxFileBytes: 1024 * 1024,
  maxFiles: 5,
  maxAgeMs: 14 * 24 * 60 * 60 * 1_000,
  // Lines waiting for the disk; beyond this, lines are counted and reported as dropped.
  maxPendingLines: 1_000,
} as const;

const LOG_FILE_NAME = "main.log";
const ROTATED_LOG_PATTERN = /^main\.(\d+)\.log$/;

type DiagnosticLevel = "error" | "warn" | "info";

export type DiagnosticLogPolicy = typeof DIAGNOSTIC_LOG_POLICY;

/** A diagnostic sink; the desktop writes to disk, tests may record calls instead. */
export interface Diagnostics {
  error(context: string, error?: unknown): void;
  warn(context: string, error?: unknown): void;
  info(context: string): void;
}

// A newer profile has fewer rotated files than the policy allows.
function ignoreMissingFile(error: unknown): void {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") return;

  throw error;
}

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (error === undefined) return "";

  return String(error);
}

/**
 * Rotating main-process diagnostic log in `<user data>/logs`. Callers pass operation names and
 * errors, never credentials or document, transcript, or imported text. Writes are serialized and
 * never block the caller.
 */
export class DiagnosticLog implements Diagnostics {
  private pending: string[] = [];
  private droppedLineCount = 0;
  private writing: Promise<void> = Promise.resolve();
  private isWriteScheduled = false;

  constructor(
    private readonly directory: string,
    private readonly policy: DiagnosticLogPolicy = DIAGNOSTIC_LOG_POLICY,
    private readonly now: () => number = Date.now,
  ) {}

  /** Creates the log directory and removes rotated files older than the retention period. */
  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true });

    for (const name of await readdir(this.directory)) {
      if (name !== LOG_FILE_NAME && !ROTATED_LOG_PATTERN.test(name)) continue;

      const path = join(this.directory, name);
      const { mtimeMs } = await stat(path);

      if (this.now() - mtimeMs > this.policy.maxAgeMs) await rm(path, { force: true });
    }
  }

  error(context: string, error?: unknown): void {
    this.record("error", context, error);
  }

  warn(context: string, error?: unknown): void {
    this.record("warn", context, error);
  }

  info(context: string): void {
    this.record("info", context);
  }

  /** Resolves after every line recorded so far has been written. */
  async flush(): Promise<void> {
    while (this.isWriteScheduled || this.pending.length > 0) {
      this.scheduleWrite();
      await this.writing;
    }
  }

  private record(level: DiagnosticLevel, context: string, error?: unknown): void {
    const detail = describe(error);
    const line = `${new Date(this.now()).toISOString()} ${level.toUpperCase()} ${context}${detail ? `: ${detail}` : ""}`;

    // The development console keeps showing diagnostics as it did before file logging.
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);

    if (this.pending.length >= this.policy.maxPendingLines) {
      this.droppedLineCount += 1;

      return;
    }

    this.pending.push(line);
    this.scheduleWrite();
  }

  private scheduleWrite(): void {
    if (this.isWriteScheduled) return;

    this.isWriteScheduled = true;
    this.writing = this.writing.then(async () => {
      const lines = this.pending;

      this.pending = [];

      if (this.droppedLineCount > 0) {
        lines.push(
          `${new Date(this.now()).toISOString()} WARN ${this.droppedLineCount} diagnostic lines were dropped while the log was busy`,
        );
        this.droppedLineCount = 0;
      }

      this.isWriteScheduled = false;

      try {
        await this.append(`${lines.join("\n")}\n`);
      } catch (error) {
        console.error("Unable to write the diagnostic log", error);
      }
    });
  }

  private async append(text: string): Promise<void> {
    const path = join(this.directory, LOG_FILE_NAME);
    const size = await stat(path).then(
      (file) => file.size,
      () => 0,
    );

    if (size > 0 && size + Buffer.byteLength(text) > this.policy.maxFileBytes) {
      await this.rotate();
    }

    await appendFile(path, text, "utf8");
  }

  /** main.log becomes main.1.log; the oldest file beyond the limit is removed. */
  private async rotate(): Promise<void> {
    await rm(join(this.directory, `main.${this.policy.maxFiles - 1}.log`), { force: true });

    for (let index = this.policy.maxFiles - 2; index >= 1; index -= 1) {
      await rename(
        join(this.directory, `main.${index}.log`),
        join(this.directory, `main.${index + 1}.log`),
      ).catch(ignoreMissingFile);
    }

    await rename(join(this.directory, LOG_FILE_NAME), join(this.directory, "main.1.log"));
  }
}
