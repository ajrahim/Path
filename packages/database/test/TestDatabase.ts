import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach } from "vitest";
import { createRepositories, openDatabase, type DatabaseConnection } from "../src";

export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

export function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "path-database-"));

  temporaryDirectories.push(directory);

  return directory;
}

/** A real file-backed database using the committed migrations, reopenable like an app restart. */
export function openTestDatabase(databasePath = join(temporaryDirectory(), "database.sqlite")) {
  const connection: DatabaseConnection = openDatabase(databasePath, MIGRATIONS_FOLDER);
  const repositories = createRepositories(connection.db);

  return { connection, databasePath, ...repositories };
}

export type TestDatabase = ReturnType<typeof openTestDatabase>;

export function createTestRecording(
  database: TestDatabase,
  overrides: { id?: string; rootPath?: string; startedAt?: string } = {},
): string {
  const id = overrides.id ?? randomUUID();
  const root = database.storageRoots.register(overrides.rootPath ?? join(tmpdir(), "path-root"));

  database.recordings.create({
    id,
    storageRootId: root.id,
    title: "Recorded walkthrough",
    captureMode: "display",
    startedAt: overrides.startedAt ?? "2026-09-14T09:59:58.000Z",
  });

  return id;
}
