import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { TimelineImportKind } from "@path/shared";
import type { PathDatabase } from "./Connection";
import { timelineImportEntries, timelineImports } from "./Schema";

// Stay well below SQLite's bound-parameter limit for one multi-row insert.
const ENTRY_INSERT_BATCH_SIZE = 1_000;

/** An imported file with its rows in original wall-clock order; alignment happens on read. */
export interface StoredTimelineImport {
  kind: TimelineImportKind;
  fileName: string;
  offsetMs: number;
  unreadableLineCount: number;
  importedAt: string;
  rows: { id: number; occurredAtMs: number; text: string }[];
}

export interface ReplaceTimelineImportInput {
  recordingId: string;
  kind: TimelineImportKind;
  fileName: string;
  unreadableLineCount: number;
  rows: { occurredAtMs: number; text: string }[];
}

/** Owns imported log and element rows; each recording keeps at most one import per kind. */
export class TimelineImportRepository {
  constructor(private readonly db: PathDatabase) {}

  async get(recordingId: string, kind: TimelineImportKind): Promise<StoredTimelineImport | null> {
    const row = this.db
      .select()
      .from(timelineImports)
      .where(and(eq(timelineImports.recordingId, recordingId), eq(timelineImports.kind, kind)))
      .get();

    if (!row) return null;

    const rows = this.db
      .select({
        id: timelineImportEntries.id,
        occurredAtMs: timelineImportEntries.occurredAtMs,
        text: timelineImportEntries.text,
      })
      .from(timelineImportEntries)
      .where(eq(timelineImportEntries.importId, row.id))
      .orderBy(asc(timelineImportEntries.occurredAtMs), asc(timelineImportEntries.id))
      .all();

    return {
      kind: row.kind,
      fileName: row.fileName,
      offsetMs: row.offsetMs,
      unreadableLineCount: row.unreadableLineCount,
      importedAt: row.importedAt,
      rows,
    };
  }

  /** Replace the kind's previous import atomically; a failed insert keeps the earlier rows. */
  async replace(input: ReplaceTimelineImportInput): Promise<StoredTimelineImport> {
    const importId = randomUUID();

    this.db.transaction((tx) => {
      tx.delete(timelineImports)
        .where(
          and(
            eq(timelineImports.recordingId, input.recordingId),
            eq(timelineImports.kind, input.kind),
          ),
        )
        .run();

      tx.insert(timelineImports)
        .values({
          id: importId,
          recordingId: input.recordingId,
          kind: input.kind,
          fileName: input.fileName,
          offsetMs: 0,
          unreadableLineCount: input.unreadableLineCount,
          importedAt: new Date().toISOString(),
        })
        .run();

      for (let start = 0; start < input.rows.length; start += ENTRY_INSERT_BATCH_SIZE) {
        tx.insert(timelineImportEntries)
          .values(
            input.rows
              .slice(start, start + ENTRY_INSERT_BATCH_SIZE)
              .map((row) => ({ importId, occurredAtMs: row.occurredAtMs, text: row.text })),
          )
          .run();
      }
    });

    return this.require(input.recordingId, input.kind);
  }

  async updateOffset(
    recordingId: string,
    kind: TimelineImportKind,
    offsetMs: number,
  ): Promise<StoredTimelineImport> {
    const result = this.db
      .update(timelineImports)
      .set({ offsetMs })
      .where(and(eq(timelineImports.recordingId, recordingId), eq(timelineImports.kind, kind)))
      .run();

    if (result.changes === 0) throw new Error(`No ${kind} import exists for this recording`);

    return this.require(recordingId, kind);
  }

  /** Entry rows cascade with their import; the recording and its activity are untouched. */
  async remove(recordingId: string, kind: TimelineImportKind): Promise<void> {
    this.db
      .delete(timelineImports)
      .where(and(eq(timelineImports.recordingId, recordingId), eq(timelineImports.kind, kind)))
      .run();
  }

  private async require(
    recordingId: string,
    kind: TimelineImportKind,
  ): Promise<StoredTimelineImport> {
    const stored = await this.get(recordingId, kind);

    if (!stored) throw new Error(`No ${kind} import exists for this recording`);

    return stored;
  }
}
