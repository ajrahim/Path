import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRepositories, openDatabase } from "@path/database";
import {
  createRemoteRepositories,
  type RemoteRepositories,
  type TimelineFileImporter,
} from "../src/storage/DatabaseClient";
import { runTimelineFileImport } from "../src/storage/TimelineImportJob";
import { MIGRATIONS_FOLDER } from "./DatabaseWorkerBundle";

/**
 * The real repositories and import job behind the same asynchronous interface the worker
 * provides. Values are cloned across the boundary, as structured cloning does between threads.
 */
export function openInProcessDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "path-desktop-db-"));
  const connection = openDatabase(join(directory, "database.sqlite"), MIGRATIONS_FOLDER);
  const local = createRepositories(connection.db);
  const repositories: RemoteRepositories = createRemoteRepositories(
    async (repository, method, args) => {
      const target = local[repository] as unknown as Record<
        string,
        (...values: unknown[]) => unknown
      >;

      const result = target[method]?.apply(local[repository], structuredClone(args));

      return structuredClone(result);
    },
  );

  const importer: TimelineFileImporter = {
    importTimelineFile: async (job) => structuredClone(await runTimelineFileImport(local, job)),
  };

  return {
    directory,
    repositories,
    importer,
    close() {
      connection.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

export type InProcessDatabase = ReturnType<typeof openInProcessDatabase>;

/** Creates a recording whose media stopped at 10:00:00 UTC with the given duration and pauses. */
export async function createStoppedRecording(
  database: InProcessDatabase,
  options: {
    durationMs?: number;
    pauses?: { atMs: number; durationMs: number }[];
    title?: string;
  } = {},
): Promise<string> {
  const id = randomUUID();
  const root = await database.repositories.storageRoots.register(join(database.directory, "media"));

  await database.repositories.recordings.create({
    id,
    storageRootId: root.id,
    title: options.title ?? "Walkthrough",
    captureMode: "display",
    startedAt: "2026-09-14T09:59:58.000Z",
  });
  await database.repositories.recordings.recordMediaTiming(id, {
    startedAt: "2026-09-14T10:00:00.000Z",
    pauses: options.pauses ?? [],
  });
  await database.repositories.recordings.markProcessing(
    id,
    options.durationMs ?? 30_000,
    join(database.directory, "media", id, "recording.webm"),
  );

  return id;
}
