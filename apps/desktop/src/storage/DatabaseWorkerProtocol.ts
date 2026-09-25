import type { RepositoryName, StoredTimelineImport } from "@path/database";
import type { TimelineImportKind } from "@path/shared";

/** Passed as `workerData`; the worker owns the only connection to this file. */
export interface DatabaseWorkerOptions {
  databasePath: string;
  migrationsFolder: string;
}

/** A file chosen by the main process, streamed into a staging import by the worker. */
export interface TimelineFileImportJob {
  recordingId: string;
  kind: TimelineImportKind;
  filePath: string;
  fileName: string;
  /** Local date that time-only rows resolve against. */
  referenceMs: number;
  maxBytes: number;
}

export type TimelineFileImportOutcome =
  | { status: "imported"; timelineImport: StoredTimelineImport }
  | { status: "too-large" }
  | { status: "no-rows" };

export type DatabaseRequest =
  | { id: number; type: "call"; repository: RepositoryName; method: string; args: unknown[] }
  | { id: number; type: "import-timeline-file"; job: TimelineFileImportJob }
  | { id: number; type: "close" };

/** Error identity crosses the thread boundary by name and message only. */
export interface SerializedDatabaseError {
  name: string;
  message: string;
}

export type DatabaseWorkerMessage =
  | { type: "ready"; discardedStagingImports: number }
  | { type: "init-failed"; error: SerializedDatabaseError }
  | { type: "response"; id: number; ok: true; value: unknown }
  | { type: "response"; id: number; ok: false; error: SerializedDatabaseError };

export function serializeDatabaseError(error: unknown): SerializedDatabaseError {
  if (error instanceof Error) return { name: error.name, message: error.message };

  return { name: "Error", message: String(error) };
}

export function deserializeDatabaseError(serialized: SerializedDatabaseError): Error {
  const error = new Error(serialized.message);

  error.name = serialized.name;

  return error;
}
