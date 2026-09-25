import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DIAGNOSTIC_LOG_POLICY, DiagnosticLog } from "../src/storage/DiagnosticLog";

const directories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function logDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "path-logs-"));

  directories.push(directory);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);

  return join(directory, "logs");
}

describe("DiagnosticLog", () => {
  it("writes errors with their names and messages on first launch", async () => {
    const directory = logDirectory();
    const log = new DiagnosticLog(directory);

    await log.initialize();
    log.error("Local transcription failed", new TypeError("model missing"));
    log.info("Startup complete");
    await log.flush();

    const text = readFileSync(join(directory, "main.log"), "utf8");

    expect(text).toMatch(/ERROR Local transcription failed: TypeError: model missing\n/);
    expect(text).toMatch(/INFO Startup complete\n$/);
  });

  it("rotates by size and keeps a bounded number of files", async () => {
    const directory = logDirectory();
    const log = new DiagnosticLog(directory, {
      ...DIAGNOSTIC_LOG_POLICY,
      maxFileBytes: 200,
      maxFiles: 3,
    });

    await log.initialize();

    for (let index = 0; index < 40; index += 1) {
      log.warn(`Diagnostic entry number ${index} with some padding text`);
      await log.flush();
    }

    expect(readdirSync(directory).sort()).toEqual(["main.1.log", "main.2.log", "main.log"]);
    expect(readFileSync(join(directory, "main.log"), "utf8")).toContain("number 39");
  });

  it("removes log files past the retention period and nothing else", async () => {
    const directory = logDirectory();
    const old = Date.now() / 1_000 - 30 * 24 * 60 * 60;

    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "main.2.log"), "old");
    writeFileSync(join(directory, "main.log"), "recent");
    writeFileSync(join(directory, "notes.txt"), "not a diagnostic log");
    utimesSync(join(directory, "main.2.log"), old, old);
    utimesSync(join(directory, "notes.txt"), old, old);

    await new DiagnosticLog(directory).initialize();

    expect(readdirSync(directory).sort()).toEqual(["main.log", "notes.txt"]);
  });

  it("counts lines dropped while too many are pending instead of growing without bound", async () => {
    const directory = logDirectory();
    const log = new DiagnosticLog(directory, { ...DIAGNOSTIC_LOG_POLICY, maxPendingLines: 3 });

    await log.initialize();

    for (let index = 0; index < 10; index += 1) log.warn(`burst ${index}`);
    await log.flush();

    const text = readFileSync(join(directory, "main.log"), "utf8");

    expect(text).toContain("burst 0");
    expect(text).toContain("diagnostic lines were dropped");
  });
});
