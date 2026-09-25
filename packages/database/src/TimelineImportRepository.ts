import { randomUUID } from "node:crypto";
import { and, asc, between, count, eq, sql, type SQL } from "drizzle-orm";
import type { TimelineImportKind } from "@path/shared";
import type { PathDatabase } from "./Connection";
import { RecordNotFoundError } from "./DatabaseErrors";
import { timelineImportEntries, timelineImports } from "./Schema";

// Stay well below SQLite's bound-parameter limit for one multi-row insert.
const ENTRY_INSERT_BATCH_SIZE = 1_000;

// Recent range counts; a filtered count scans every row in the range, and paging repeats it.
const MAX_CACHED_ROW_COUNTS = 32;

/** A ready import's metadata; its rows are read by range. */
export interface StoredTimelineImport {
  id: string;
  kind: TimelineImportKind;
  fileName: string;
  offsetMs: number;
  rowCount: number;
  unreadableLineCount: number;
  importedAt: string;
}

/** An imported row with its original wall-clock time. */
export interface StoredTimelineRow {
  id: number;
  occurredAtMs: number;
  text: string;
}

/** Inclusive wall-clock bounds for stored rows, already adjusted for the import's offset. */
export interface TimelineRowRange {
  importId: string;
  startMs: number;
  endMs: number;
  /** Case-insensitive substring filter; ASCII letters fold case, as in SQLite's LIKE. */
  query?: string;
}

const importColumns = {
  id: timelineImports.id,
  kind: timelineImports.kind,
  fileName: timelineImports.fileName,
  offsetMs: timelineImports.offsetMs,
  rowCount: timelineImports.rowCount,
  unreadableLineCount: timelineImports.unreadableLineCount,
  importedAt: timelineImports.importedAt,
};

function readyImportFilter(recordingId: string, kind: TimelineImportKind): SQL | undefined {
  return and(
    eq(timelineImports.recordingId, recordingId),
    eq(timelineImports.kind, kind),
    eq(timelineImports.state, "ready"),
  );
}

function escapeLikePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

function rangeFilter(range: TimelineRowRange): SQL | undefined {
  const inRange = and(
    eq(timelineImportEntries.importId, range.importId),
    between(timelineImportEntries.occurredAtMs, range.startMs, range.endMs),
  );

  if (!range.query) return inRange;

  return and(
    inRange,
    sql`${timelineImportEntries.text} LIKE ${escapeLikePattern(range.query)} ESCAPE '\\'`,
  );
}

/**
 * Owns imported log and element rows; each recording keeps at most one ready import per kind.
 * Ready imports are immutable except for their offset, so a range read is always consistent.
 */
export class TimelineImportRepository {
  // Ready rows never change, so a count for the same import, bounds, and query stays valid.
  private readonly rowCounts = new Map<string, number>();

  constructor(private readonly db: PathDatabase) {}

  getReady(recordingId: string, kind: TimelineImportKind): StoredTimelineImport | null {
    const row = this.db
      .select(importColumns)
      .from(timelineImports)
      .where(readyImportFilter(recordingId, kind))
      .get();

    return row ?? null;
  }

  /** Starts a replacement that stays invisible until `promoteStaging` commits it. */
  beginStaging(recordingId: string, kind: TimelineImportKind, fileName: string): string {
    const importId = randomUUID();

    this.db
      .insert(timelineImports)
      .values({
        id: importId,
        recordingId,
        kind,
        state: "staging",
        fileName,
        importedAt: new Date().toISOString(),
      })
      .run();

    return importId;
  }

  /** Appends one batch in its own transaction; other requests may run between batches. */
  appendStagingRows(importId: string, rows: { occurredAtMs: number; text: string }[]): void {
    this.db.transaction((tx) => {
      const staging = tx
        .select({ state: timelineImports.state })
        .from(timelineImports)
        .where(eq(timelineImports.id, importId))
        .get();

      // The recording may have been deleted mid-import, which cascades the staging import.
      if (staging?.state !== "staging") {
        throw new RecordNotFoundError("The import was canceled because its recording was removed");
      }

      for (let start = 0; start < rows.length; start += ENTRY_INSERT_BATCH_SIZE) {
        tx.insert(timelineImportEntries)
          .values(
            rows
              .slice(start, start + ENTRY_INSERT_BATCH_SIZE)
              .map((row) => ({ importId, occurredAtMs: row.occurredAtMs, text: row.text })),
          )
          .run();
      }
    });
  }

  /** Atomically replaces the kind's ready import; a failure keeps the previous rows visible. */
  promoteStaging(importId: string, unreadableLineCount: number): StoredTimelineImport {
    return this.db.transaction((tx) => {
      const staging = tx
        .select({ recordingId: timelineImports.recordingId, kind: timelineImports.kind })
        .from(timelineImports)
        .where(and(eq(timelineImports.id, importId), eq(timelineImports.state, "staging")))
        .get();

      if (!staging) {
        throw new RecordNotFoundError("The import was canceled because its recording was removed");
      }

      const rowCount =
        tx
          .select({ value: count() })
          .from(timelineImportEntries)
          .where(eq(timelineImportEntries.importId, importId))
          .get()?.value ?? 0;

      tx.delete(timelineImports).where(readyImportFilter(staging.recordingId, staging.kind)).run();

      return tx
        .update(timelineImports)
        .set({
          state: "ready",
          rowCount,
          unreadableLineCount,
          importedAt: new Date().toISOString(),
        })
        .where(eq(timelineImports.id, importId))
        .returning(importColumns)
        .get();
    });
  }

  discardStaging(importId: string): void {
    this.db
      .delete(timelineImports)
      .where(and(eq(timelineImports.id, importId), eq(timelineImports.state, "staging")))
      .run();
  }

  /** Startup recovery: an import interrupted by a crash never became visible, so drop it. */
  discardAllStaging(): number {
    return this.db.delete(timelineImports).where(eq(timelineImports.state, "staging")).run()
      .changes;
  }

  updateOffset(
    recordingId: string,
    kind: TimelineImportKind,
    offsetMs: number,
  ): StoredTimelineImport {
    const updated = this.db
      .update(timelineImports)
      .set({ offsetMs })
      .where(readyImportFilter(recordingId, kind))
      .returning(importColumns)
      .get();

    if (!updated) throw new RecordNotFoundError(`No ${kind} import exists for this recording`);

    return updated;
  }

  /** Entry rows cascade with their import; the recording and its activity are untouched. */
  remove(recordingId: string, kind: TimelineImportKind): void {
    this.db.delete(timelineImports).where(readyImportFilter(recordingId, kind)).run();
  }

  countRows(range: TimelineRowRange): number {
    const key = JSON.stringify([range.importId, range.startMs, range.endMs, range.query ?? ""]);
    const cached = this.rowCounts.get(key);

    if (cached !== undefined) return cached;

    const total =
      this.db.select({ value: count() }).from(timelineImportEntries).where(rangeFilter(range)).get()
        ?.value ?? 0;

    this.rowCounts.set(key, total);

    if (this.rowCounts.size > MAX_CACHED_ROW_COUNTS) {
      this.rowCounts.delete(this.rowCounts.keys().next().value ?? key);
    }

    return total;
  }

  /** Rows in chronological order, `start` rows into the range. */
  listRows(range: TimelineRowRange, start: number, limit: number): StoredTimelineRow[] {
    return this.db
      .select({
        id: timelineImportEntries.id,
        occurredAtMs: timelineImportEntries.occurredAtMs,
        text: timelineImportEntries.text,
      })
      .from(timelineImportEntries)
      .where(rangeFilter(range))
      .orderBy(asc(timelineImportEntries.occurredAtMs), asc(timelineImportEntries.id))
      .limit(limit)
      .offset(start)
      .all();
  }

  /**
   * Up to `limit` rows spread evenly across the whole range: the first row of each of `limit`
   * equal position buckets. Every row in the range is considered, whatever a UI has loaded.
   */
  sampleRows(range: TimelineRowRange, limit: number): StoredTimelineRow[] {
    const total = this.countRows(range);

    if (total <= limit) return this.listRows(range, 0, total);

    // Bound numbers arrive as REAL; the bucket arithmetic below needs integer division.
    const sampleSize = sql`CAST(${limit} AS INTEGER)`;
    const rowTotal = sql`CAST(${total} AS INTEGER)`;

    return this.db.all<StoredTimelineRow>(sql`
      SELECT id, occurred_at_ms AS occurredAtMs, text FROM (
        SELECT id, occurred_at_ms, text,
          row_number() OVER (ORDER BY occurred_at_ms, id) - 1 AS position
        FROM ${timelineImportEntries}
        WHERE ${rangeFilter(range)}
      )
      WHERE position = 0
        OR (position * ${sampleSize}) / ${rowTotal} != ((position - 1) * ${sampleSize}) / ${rowTotal}
      ORDER BY occurred_at_ms, id
    `);
  }
}
