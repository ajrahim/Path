import { join } from "node:path";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import type {
  CaptureMode,
  CaptureRegion,
  ClickEvent,
  RecordingMediaTiming,
  RecordingSession,
  RecordingSummary,
  TranscriptSegment,
} from "@path/shared";
import type { PathDatabase } from "./Connection";
import { RecordNotFoundError } from "./DatabaseErrors";
import {
  assetDeletions,
  clickEvents,
  recordings,
  storageRoots,
  transcriptSegments,
  type RecordingRow,
} from "./Schema";

// Stay well below SQLite's bound-parameter limit for one multi-row insert.
const CLICK_INSERT_BATCH_SIZE = 200;

function recordingNotFound(id: string): RecordNotFoundError {
  return new RecordNotFoundError(`Recording not found: ${id}`);
}

// History receives metadata without the session's managed video/audio paths.
function toSummary(row: RecordingRow): RecordingSummary {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    captureMode: row.captureMode,
    durationMs: row.durationMs,
    thumbnailPath: row.thumbnailPath,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    transcriptStatus: row.transcriptStatus,
  };
}

function toSession(row: RecordingRow): RecordingSession {
  return {
    ...toSummary(row),
    captureRegion: row.captureRegionJson,
    videoPath: row.videoPath,
    audioPath: row.audioPath,
    mediaTiming: row.mediaStartedAt
      ? { startedAt: row.mediaStartedAt, pauses: row.mediaPausesJson ?? [] }
      : null,
  };
}

function toTranscriptSegment(segment: typeof transcriptSegments.$inferSelect): TranscriptSegment {
  // Optional DTO fields are omitted rather than leaking SQLite's null representation.
  return {
    id: segment.id,
    recordingId: segment.recordingId,
    startMs: segment.startMs,
    endMs: segment.endMs,
    text: segment.text,
    ...(segment.speaker !== null ? { speaker: segment.speaker } : {}),
    ...(segment.confidence !== null ? { confidence: segment.confidence } : {}),
  };
}

export interface CreateRecordingInput {
  id: string;
  storageRootId: string;
  title: string;
  captureMode: CaptureMode;
  captureRegion?: CaptureRegion;
  startedAt: string;
}

/** Where a recording's managed assets live: `<storageRootPath>/<recordingId>/`. */
export interface RecordingAssetLocation {
  recordingId: string;
  storageRootPath: string;
}

/**
 * Owns recording metadata and activity rows. Methods are synchronous because they run inside the
 * desktop's database worker, where each call executes to completion before the next begins.
 */
export class RecordingRepository {
  constructor(private readonly db: PathDatabase) {}

  list(): RecordingSummary[] {
    return this.db
      .select()
      .from(recordings)
      .orderBy(desc(recordings.createdAt))
      .all()
      .map(toSummary);
  }

  get(id: string): RecordingSession | null {
    const row = this.db.select().from(recordings).where(eq(recordings.id, id)).get();

    return row ? toSession(row) : null;
  }

  getAssetLocation(id: string): RecordingAssetLocation | null {
    const row = this.db
      .select({ recordingId: recordings.id, storageRootPath: storageRoots.path })
      .from(recordings)
      .innerJoin(storageRoots, eq(storageRoots.id, recordings.storageRootId))
      .where(eq(recordings.id, id))
      .get();

    return row ?? null;
  }

  create(input: CreateRecordingInput): RecordingSession {
    const now = new Date().toISOString();
    const row = this.db
      .insert(recordings)
      .values({
        id: input.id,
        storageRootId: input.storageRootId,
        title: input.title,
        status: "recording",
        captureMode: input.captureMode,
        captureRegionJson: input.captureRegion,
        startedAt: input.startedAt,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    return toSession(row);
  }

  rename(id: string, title: string): RecordingSummary {
    const row = this.db
      .update(recordings)
      .set({ title, updatedAt: new Date().toISOString() })
      .where(eq(recordings.id, id))
      .returning()
      .get();

    if (!row) throw recordingNotFound(id);

    return toSummary(row);
  }

  markProcessing(id: string, durationMs: number, videoPath: string): void {
    const result = this.db
      .update(recordings)
      .set({ status: "processing", durationMs, videoPath, updatedAt: new Date().toISOString() })
      .where(eq(recordings.id, id))
      .run();

    if (result.changes === 0) throw recordingNotFound(id);
  }

  /** Stored once capture completes so imported wall-clock evidence can be aligned to media time. */
  recordMediaTiming(id: string, timing: RecordingMediaTiming): void {
    const result = this.db
      .update(recordings)
      .set({ mediaStartedAt: timing.startedAt, mediaPausesJson: timing.pauses })
      .where(eq(recordings.id, id))
      .run();

    if (result.changes === 0) throw recordingNotFound(id);
  }

  /** A final processed path may replace the raw path without changing the recording's identity. */
  markReady(id: string, completedAt: string, videoPath?: string, thumbnailPath?: string): void {
    const result = this.db
      .update(recordings)
      .set({
        status: "ready",
        completedAt,
        updatedAt: completedAt,
        ...(videoPath ? { videoPath } : {}),
        ...(thumbnailPath ? { thumbnailPath } : {}),
      })
      .where(eq(recordings.id, id))
      .run();

    if (result.changes === 0) throw recordingNotFound(id);
  }

  markFailed(ids: string | string[]): void {
    const recordingIds = Array.isArray(ids) ? ids : [ids];

    if (recordingIds.length === 0) return;

    this.db
      .update(recordings)
      .set({ status: "failed", updatedAt: new Date().toISOString() })
      .where(inArray(recordings.id, recordingIds))
      .run();
  }

  /**
   * Startup recovery: interrupted captures cannot resume. They are marked failed, and their
   * incomplete media directories are queued for deletion in the same transaction.
   */
  failUnfinished(): RecordingAssetLocation[] {
    return this.db.transaction((tx) => {
      const unfinished = tx
        .select({ recordingId: recordings.id, storageRootPath: storageRoots.path })
        .from(recordings)
        .innerJoin(storageRoots, eq(storageRoots.id, recordings.storageRootId))
        .where(or(eq(recordings.status, "recording"), eq(recordings.status, "processing")))
        .all();

      if (unfinished.length === 0) return [];

      tx.update(recordings)
        .set({ status: "failed", transcriptStatus: "failed", updatedAt: new Date().toISOString() })
        .where(
          inArray(
            recordings.id,
            unfinished.map((recording) => recording.recordingId),
          ),
        )
        .run();

      queueAssetDeletions(
        tx,
        unfinished.map((location) => ({
          path: recordingDirectoryPath(location),
          isDirectory: true,
        })),
      );

      return unfinished;
    });
  }

  /** Ready recordings and their final media paths, read in one query for startup validation. */
  listReadyMedia(): { id: string; videoPath: string | null }[] {
    return this.db
      .select({ id: recordings.id, videoPath: recordings.videoPath })
      .from(recordings)
      .where(eq(recordings.status, "ready"))
      .all();
  }

  markTranscriptProcessing(id: string, audioPath: string): void {
    this.db
      .update(recordings)
      .set({ transcriptStatus: "processing", audioPath, updatedAt: new Date().toISOString() })
      .where(eq(recordings.id, id))
      .run();
  }

  markTranscriptReady(id: string): void {
    this.db
      .update(recordings)
      .set({ transcriptStatus: "ready", updatedAt: new Date().toISOString() })
      .where(eq(recordings.id, id))
      .run();
  }

  markTranscriptFailed(id: string): void {
    this.db
      .update(recordings)
      .set({ transcriptStatus: "failed", updatedAt: new Date().toISOString() })
      .where(eq(recordings.id, id))
      .run();
  }

  /** Replaces the whole transcript atomically; a failed insert keeps the previous segments. */
  replaceTranscript(recordingId: string, segments: TranscriptSegment[]): void {
    this.db.transaction((tx) => {
      tx.delete(transcriptSegments).where(eq(transcriptSegments.recordingId, recordingId)).run();

      if (segments.length === 0) return;

      // Ownership comes from the requested recording, not IDs supplied by a provider.
      tx.insert(transcriptSegments)
        .values(segments.map((segment) => ({ ...segment, recordingId })))
        .run();
    });
  }

  listTranscript(recordingId: string): TranscriptSegment[] {
    return this.db
      .select()
      .from(transcriptSegments)
      .where(eq(transcriptSegments.recordingId, recordingId))
      .orderBy(transcriptSegments.startMs)
      .all()
      .map(toTranscriptSegment);
  }

  updateTranscript(recordingId: string, id: string, text: string): TranscriptSegment {
    const segment = this.db
      .update(transcriptSegments)
      .set({ text })
      .where(and(eq(transcriptSegments.recordingId, recordingId), eq(transcriptSegments.id, id)))
      .returning()
      .get();

    if (!segment) throw new RecordNotFoundError(`Transcript segment not found: ${id}`);

    return toTranscriptSegment(segment);
  }

  deleteTranscript(recordingId: string, id: string): void {
    const result = this.db
      .delete(transcriptSegments)
      .where(and(eq(transcriptSegments.recordingId, recordingId), eq(transcriptSegments.id, id)))
      .run();

    if (result.changes === 0) throw new RecordNotFoundError(`Transcript segment not found: ${id}`);
  }

  /** Inserts captured clicks in one transaction; either the whole batch is stored or none is. */
  insertClicks(clicks: ClickEvent[]): void {
    if (clicks.length === 0) return;

    this.db.transaction((tx) => {
      for (let start = 0; start < clicks.length; start += CLICK_INSERT_BATCH_SIZE) {
        tx.insert(clickEvents)
          .values(clicks.slice(start, start + CLICK_INSERT_BATCH_SIZE))
          .run();
      }
    });
  }

  updateClickActionDescription(id: string, actionDescription: string): void {
    this.db.update(clickEvents).set({ actionDescription }).where(eq(clickEvents.id, id)).run();
  }

  listClicks(recordingId: string): ClickEvent[] {
    return this.db
      .select()
      .from(clickEvents)
      .where(eq(clickEvents.recordingId, recordingId))
      .orderBy(clickEvents.timestampMs)
      .all();
  }

  /** Match both IDs so a screenshot lookup cannot cross recording ownership. */
  getClick(recordingId: string, clickId: string): ClickEvent | null {
    const click = this.db
      .select()
      .from(clickEvents)
      .where(and(eq(clickEvents.recordingId, recordingId), eq(clickEvents.id, clickId)))
      .get();

    return click ?? null;
  }

  /** Removes the row and queues its screenshot for deletion in the same transaction. */
  deleteClick(recordingId: string, id: string): void {
    this.db.transaction((tx) => {
      const click = tx
        .delete(clickEvents)
        .where(and(eq(clickEvents.recordingId, recordingId), eq(clickEvents.id, id)))
        .returning({ screenshotPath: clickEvents.screenshotPath })
        .get();

      if (!click) throw new RecordNotFoundError(`Click event not found: ${id}`);

      if (click.screenshotPath) {
        queueAssetDeletions(tx, [{ path: click.screenshotPath, isDirectory: false }]);
      }
    });
  }

  updateClickDescription(recordingId: string, id: string, actionDescription: string): ClickEvent {
    const click = this.db
      .update(clickEvents)
      .set({ actionDescription })
      .where(and(eq(clickEvents.recordingId, recordingId), eq(clickEvents.id, id)))
      .returning()
      .get();

    if (!click) throw new RecordNotFoundError(`Click event not found: ${id}`);

    return click;
  }

  /**
   * Foreign-key cascades remove activity, imports, and document history. The recording's asset
   * directory is queued for deletion in the same transaction, so files are never orphaned.
   */
  delete(id: string): void {
    this.db.transaction((tx) => {
      const location = tx
        .select({ recordingId: recordings.id, storageRootPath: storageRoots.path })
        .from(recordings)
        .innerJoin(storageRoots, eq(storageRoots.id, recordings.storageRootId))
        .where(eq(recordings.id, id))
        .get();

      if (!location) return;

      tx.delete(recordings).where(eq(recordings.id, id)).run();
      queueAssetDeletions(tx, [{ path: recordingDirectoryPath(location), isDirectory: true }]);
    });
  }
}

type Transaction = Parameters<Parameters<PathDatabase["transaction"]>[0]>[0];

function recordingDirectoryPath(location: RecordingAssetLocation): string {
  return join(location.storageRootPath, location.recordingId);
}

function queueAssetDeletions(
  tx: Transaction,
  paths: { path: string; isDirectory: boolean }[],
): void {
  if (paths.length === 0) return;

  const requestedAt = new Date().toISOString();

  tx.insert(assetDeletions)
    .values(paths.map((entry) => ({ ...entry, requestedAt })))
    .onConflictDoNothing()
    .run();
}
