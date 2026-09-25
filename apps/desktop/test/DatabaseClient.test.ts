import { randomUUID } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import BetterSqlite3 from "better-sqlite3";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DatabaseClient, DatabaseUnavailableError } from "../src/storage/DatabaseClient";
import type { DatabaseWorkerMessage } from "../src/storage/DatabaseWorkerProtocol";
import { buildDatabaseWorker, MIGRATIONS_FOLDER, temporaryDirectory } from "./DatabaseWorkerBundle";

let workerPath: string;
const cleanups: (() => void | Promise<void>)[] = [];

beforeAll(async () => {
  workerPath = await buildDatabaseWorker();
});

afterAll(() => rmSync(workerPath, { force: true }));

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function profile(): string {
  const directory = temporaryDirectory();

  cleanups.push(directory.remove);

  return join(directory.path, "database.sqlite");
}

async function openClient(databasePath: string, onUnexpectedExit = vi.fn()) {
  const client = await DatabaseClient.open({
    workerPath,
    databasePath,
    migrationsFolder: MIGRATIONS_FOLDER,
    onUnexpectedExit,
  });

  cleanups.push(() => client.close(5_000));

  return client;
}

async function createRecording(client: DatabaseClient): Promise<string> {
  const id = randomUUID();
  const root = await client.repositories.storageRoots.register(join("C:", "Recordings"));

  await client.repositories.recordings.create({
    id,
    storageRootId: root.id,
    title: "Worker recording",
    captureMode: "display",
    startedAt: "2026-09-14T10:00:00.000Z",
  });

  return id;
}

function writeLog(path: string, rows: number): void {
  const lines = Array.from(
    { length: rows },
    (_, index) =>
      `2026-09-14T10:${String(Math.floor(index / 60_000) % 60).padStart(2, "0")}:00.${String(index % 1_000).padStart(3, "0")}Z row ${index}`,
  );

  writeFileSync(path, `﻿${lines.join("\n")}\n  continuation of the last row\n`);
}

describe("DatabaseClient", () => {
  it("initializes a new profile, keeps request order, and survives a restart", async () => {
    const databasePath = profile();
    const client = await openClient(databasePath);
    const recordingId = await createRecording(client);

    // Sent without awaiting: order is preserved, so each draft sees the previous version.
    const writes = [0, 1, 2].map((version) =>
      client.repositories.documents.saveDraft(recordingId, `# Draft ${version}`, version),
    );

    await expect(Promise.all(writes)).resolves.toEqual([
      { status: "stored", draftVersion: 1, hasDraft: true },
      { status: "stored", draftVersion: 2, hasDraft: true },
      { status: "stored", draftVersion: 3, hasDraft: true },
    ]);

    await client.close(5_000);

    const reopened = await openClient(databasePath);

    await expect(reopened.repositories.documents.getSnapshot(recordingId)).resolves.toMatchObject({
      draft: { markdown: "# Draft 2" },
      draftVersion: 3,
    });
  });

  it("rejects repository errors with their names and keeps serving later requests", async () => {
    const client = await openClient(profile());

    await expect(
      client.repositories.recordings.rename(randomUUID(), "Missing"),
    ).rejects.toMatchObject({
      name: "RecordNotFoundError",
      message: expect.stringContaining("Recording not found"),
    });
    await expect(client.repositories.recordings.list()).resolves.toEqual([]);
  });

  it("refuses a database from another schema lineage without changing it", async () => {
    const databasePath = profile();
    const foreign = new BetterSqlite3(databasePath);

    foreign.exec(`
      CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric);
      INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('pre-release', 1);
    `);
    foreign.close();

    const before = readFileSync(databasePath);

    await expect(
      DatabaseClient.open({ workerPath, databasePath, migrationsFolder: MIGRATIONS_FOLDER }),
    ).rejects.toMatchObject({ name: "DatabaseSchemaMismatchError" });
    expect(readFileSync(databasePath).equals(before)).toBe(true);
  });

  it("reports an initialization failure when migrations are unavailable", async () => {
    await expect(
      DatabaseClient.open({
        workerPath,
        databasePath: profile(),
        migrationsFolder: join(profile(), "missing"),
      }),
    ).rejects.toThrow();
  });

  it("only dispatches public repository methods", async () => {
    const worker = new Worker(workerPath, {
      workerData: { databasePath: profile(), migrationsFolder: MIGRATIONS_FOLDER },
    });

    cleanups.push(async () => {
      await worker.terminate();
    });

    const messages: DatabaseWorkerMessage[] = [];
    const response = new Promise<DatabaseWorkerMessage>((resolve) => {
      worker.on("message", (message: DatabaseWorkerMessage) => {
        messages.push(message);
        if (message.type === "response") resolve(message);
      });
    });

    worker.postMessage({
      id: 1,
      type: "call",
      repository: "recordings",
      method: "toString",
      args: [],
    });

    await expect(response).resolves.toMatchObject({
      ok: false,
      error: { message: "Unknown database operation: recordings.toString" },
    });
    expect(messages[0]).toMatchObject({ type: "ready" });
  });

  it("streams an import into the worker and applies the size limit while reading", async () => {
    const directory = temporaryDirectory();

    cleanups.push(directory.remove);

    const client = await openClient(profile());
    const recordingId = await createRecording(client);
    const logPath = join(directory.path, "app.log");

    writeLog(logPath, 12_000);

    const outcome = await client.importTimelineFile({
      recordingId,
      kind: "log",
      filePath: logPath,
      fileName: "app.log",
      referenceMs: Date.parse("2026-09-14T10:00:00.000Z"),
      maxBytes: 10 * 1024 * 1024,
    });

    expect(outcome).toMatchObject({
      status: "imported",
      timelineImport: { fileName: "app.log", rowCount: 12_000, unreadableLineCount: 0 },
    });

    const imported = outcome.status === "imported" ? outcome.timelineImport : null;
    const lastRow = await client.repositories.timelineImports.listRows(
      { importId: imported!.id, startMs: 0, endMs: Number.MAX_SAFE_INTEGER },
      11_999,
      1,
    );

    expect(lastRow[0]?.text).toBe("row 11999\n  continuation of the last row");

    await expect(
      client.importTimelineFile({
        recordingId,
        kind: "log",
        filePath: logPath,
        fileName: "app.log",
        referenceMs: 0,
        maxBytes: 1_024,
      }),
    ).resolves.toEqual({ status: "too-large" });

    // The rejected replacement never became visible.
    await expect(
      client.repositories.timelineImports.getReady(recordingId, "log"),
    ).resolves.toMatchObject({ id: imported!.id });
  });

  // Real file and database I/O; the default timeout is too tight when the whole suite runs.
  it(
    "fails pending work on an unexpected stop and recovers the interrupted import at restart",
    { timeout: 60_000 },
    async () => {
      const directory = temporaryDirectory();

      cleanups.push(directory.remove);

      const databasePath = profile();
      const onUnexpectedExit = vi.fn();
      const client = await openClient(databasePath, onUnexpectedExit);
      const recordingId = await createRecording(client);
      const logPath = join(directory.path, "large.log");

      writeLog(logPath, 150_000);

      const job = {
        recordingId,
        kind: "log" as const,
        filePath: logPath,
        fileName: "large.log",
        referenceMs: 0,
        maxBytes: 100 * 1024 * 1024,
      };

      const previous = await client.importTimelineFile({ ...job, fileName: "previous.log" });
      const interrupted = client.importTimelineFile(job);

      // Once a staging batch has committed, stop the worker the way a crash would. A separate
      // read-only connection observes the committed rows through WAL.
      const observer = new BetterSqlite3(databasePath, { readonly: true });

      cleanups.push(() => observer.close());
      await vi.waitFor(
        () => {
          const { stagedRows } = observer
            .prepare(
              `SELECT count(*) AS stagedRows FROM timeline_import_entries WHERE import_id IN
              (SELECT id FROM timeline_imports WHERE state = 'staging')`,
            )
            .get() as { stagedRows: number };

          expect(stagedRows).toBeGreaterThan(0);
        },
        { timeout: 30_000, interval: 5 },
      );
      await (client as unknown as { worker: Worker }).worker.terminate();

      await expect(interrupted).rejects.toBeInstanceOf(DatabaseUnavailableError);
      await expect(client.repositories.recordings.list()).rejects.toBeInstanceOf(
        DatabaseUnavailableError,
      );
      expect(onUnexpectedExit).toHaveBeenCalledOnce();

      const reopened = await openClient(databasePath);
      const ready = await reopened.repositories.timelineImports.getReady(recordingId, "log");

      expect(previous.status).toBe("imported");
      expect(ready).toMatchObject({ fileName: "previous.log", rowCount: 150_000 });
    },
  );

  it("drains queued writes before closing and rejects requests afterwards", async () => {
    const databasePath = profile();
    const client = await openClient(databasePath);
    const recordingId = await createRecording(client);
    const writes = Array.from({ length: 50 }, (_, version) =>
      client.repositories.documents.saveDraft(recordingId, `# ${version}`, version),
    );

    await client.close(5_000);

    await expect(Promise.all(writes)).resolves.toHaveLength(50);
    await expect(client.repositories.recordings.list()).rejects.toBeInstanceOf(
      DatabaseUnavailableError,
    );

    const reopened = await openClient(databasePath);

    await expect(reopened.repositories.documents.getSnapshot(recordingId)).resolves.toMatchObject({
      draft: { markdown: "# 49" },
      draftVersion: 50,
    });
  });
});
