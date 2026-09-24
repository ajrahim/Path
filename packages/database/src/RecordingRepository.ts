import { randomUUID } from "node:crypto";
import { and, desc, eq, or } from "drizzle-orm";
import type {
  CaptureMode,
  CaptureRegion,
  ClickEvent,
  PersistedGuide,
  RecordingMediaTiming,
  RecordingSession,
  RecordingSummary,
  TranscriptSegment,
} from "@path/shared";
import type { PathDatabase } from "./Connection";
import {
  clickEvents,
  documents,
  recordings,
  transcriptSegments,
  type RecordingRow,
} from "./Schema";

class RecordingNotFoundError extends Error {
  constructor(id: string) {
    super(`Recording not found: ${id}`);
    this.name = "RecordingNotFoundError";
  }
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
    guideStatus: row.guideStatus,
    mediaTiming: row.mediaStartedAt
      ? { startedAt: row.mediaStartedAt, pauses: row.mediaPausesJson ?? [] }
      : null,
  };
}

export interface CreateRecordingInput {
  id: string;
  title: string;
  captureMode: CaptureMode;
  captureRegion?: CaptureRegion;
  startedAt: string;
}

/** Owns recording metadata and activity rows; managed media deletion belongs to the asset service. */
export class RecordingRepository {
  constructor(private readonly db: PathDatabase) {}

  async list(): Promise<RecordingSummary[]> {
    const rows = await this.db.select().from(recordings).orderBy(desc(recordings.createdAt));

    return rows.map(toSummary);
  }

  async get(id: string): Promise<RecordingSession | null> {
    const row = await this.db.query.recordings.findFirst({ where: eq(recordings.id, id) });

    return row ? toSession(row) : null;
  }

  async create(input: CreateRecordingInput): Promise<RecordingSession> {
    const now = new Date().toISOString();

    const [row] = await this.db
      .insert(recordings)
      .values({
        id: input.id,
        title: input.title,
        status: "recording",
        captureMode: input.captureMode,
        captureRegionJson: input.captureRegion,
        startedAt: input.startedAt,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!row) {
      throw new Error("Failed to create recording");
    }

    return toSession(row);
  }

  async rename(id: string, title: string): Promise<RecordingSummary> {
    const [row] = await this.db
      .update(recordings)
      .set({ title, updatedAt: new Date().toISOString() })
      .where(eq(recordings.id, id))
      .returning();

    if (!row) {
      throw new RecordingNotFoundError(id);
    }

    return toSummary(row);
  }

  async markProcessing(id: string, durationMs: number, videoPath: string): Promise<void> {
    const result = await this.db
      .update(recordings)
      .set({ status: "processing", durationMs, videoPath, updatedAt: new Date().toISOString() })
      .where(eq(recordings.id, id));

    if (result.changes === 0) {
      throw new RecordingNotFoundError(id);
    }
  }

  /** Stored once capture completes so imported wall-clock evidence can be aligned to media time. */
  async recordMediaTiming(id: string, timing: RecordingMediaTiming): Promise<void> {
    const result = await this.db
      .update(recordings)
      .set({ mediaStartedAt: timing.startedAt, mediaPausesJson: timing.pauses })
      .where(eq(recordings.id, id));

    if (result.changes === 0) {
      throw new RecordingNotFoundError(id);
    }
  }

  /** A final processed path may replace the raw path without changing the recording's identity. */
  async markReady(
    id: string,
    completedAt: string,
    videoPath?: string,
    thumbnailPath?: string,
  ): Promise<void> {
    const result = await this.db
      .update(recordings)
      .set({
        status: "ready",
        completedAt,
        updatedAt: completedAt,
        ...(videoPath ? { videoPath } : {}),
        ...(thumbnailPath ? { thumbnailPath } : {}),
      })
      .where(eq(recordings.id, id));

    if (result.changes === 0) {
      throw new RecordingNotFoundError(id);
    }
  }

  async markFailed(id: string): Promise<void> {
    await this.db
      .update(recordings)
      .set({ status: "failed", updatedAt: new Date().toISOString() })
      .where(eq(recordings.id, id));
  }

  async listUnfinished(): Promise<RecordingSession[]> {
    const rows = await this.db
      .select()
      .from(recordings)
      .where(or(eq(recordings.status, "recording"), eq(recordings.status, "processing")));

    return rows.map(toSession);
  }

  /** Startup recovery records interruption; the desktop separately removes incomplete media. */
  async markUnfinishedFailed(): Promise<void> {
    await this.db
      .update(recordings)
      .set({ status: "failed", transcriptStatus: "failed", updatedAt: new Date().toISOString() })
      .where(or(eq(recordings.status, "recording"), eq(recordings.status, "processing")));
  }

  async markTranscriptProcessing(id: string, audioPath: string): Promise<void> {
    await this.db
      .update(recordings)
      .set({ transcriptStatus: "processing", audioPath, updatedAt: new Date().toISOString() })
      .where(eq(recordings.id, id));
  }

  async markTranscriptReady(id: string): Promise<void> {
    await this.db
      .update(recordings)
      .set({ transcriptStatus: "ready", updatedAt: new Date().toISOString() })
      .where(eq(recordings.id, id));
  }

  async markTranscriptFailed(id: string): Promise<void> {
    await this.db
      .update(recordings)
      .set({ transcriptStatus: "failed", updatedAt: new Date().toISOString() })
      .where(eq(recordings.id, id));
  }

  async replaceTranscript(recordingId: string, segments: TranscriptSegment[]): Promise<void> {
    await this.db.delete(transcriptSegments).where(eq(transcriptSegments.recordingId, recordingId));

    if (segments.length > 0) {
      // Ownership comes from the requested recording, not IDs supplied by a provider.
      await this.db
        .insert(transcriptSegments)
        .values(segments.map((segment) => ({ ...segment, recordingId })));
    }
  }

  async listTranscript(recordingId: string): Promise<TranscriptSegment[]> {
    const segments = await this.db
      .select()
      .from(transcriptSegments)
      .where(eq(transcriptSegments.recordingId, recordingId))
      .orderBy(transcriptSegments.startMs);

    // Optional DTO fields are omitted rather than leaking SQLite's null representation.
    return segments.map((segment) => ({
      id: segment.id,
      recordingId: segment.recordingId,
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: segment.text,
      ...(segment.speaker !== null ? { speaker: segment.speaker } : {}),
      ...(segment.confidence !== null ? { confidence: segment.confidence } : {}),
    }));
  }

  async updateTranscript(
    recordingId: string,
    id: string,
    text: string,
  ): Promise<TranscriptSegment> {
    const [segment] = await this.db
      .update(transcriptSegments)
      .set({ text })
      .where(and(eq(transcriptSegments.recordingId, recordingId), eq(transcriptSegments.id, id)))
      .returning();

    if (!segment) throw new Error(`Transcript segment not found: ${id}`);

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

  async deleteTranscript(recordingId: string, id: string): Promise<void> {
    const deleted = await this.db
      .delete(transcriptSegments)
      .where(and(eq(transcriptSegments.recordingId, recordingId), eq(transcriptSegments.id, id)))
      .returning({ id: transcriptSegments.id });

    if (deleted.length === 0) {
      throw new Error(`Transcript segment not found: ${id}`);
    }
  }

  async insertClick(click: ClickEvent): Promise<void> {
    await this.db.insert(clickEvents).values(click);
  }

  async updateClickScreenshot(id: string, screenshotPath: string): Promise<void> {
    await this.db.update(clickEvents).set({ screenshotPath }).where(eq(clickEvents.id, id));
  }

  async updateClickActionDescription(id: string, actionDescription: string): Promise<void> {
    await this.db.update(clickEvents).set({ actionDescription }).where(eq(clickEvents.id, id));
  }

  async listClicks(recordingId: string): Promise<ClickEvent[]> {
    return this.db
      .select()
      .from(clickEvents)
      .where(eq(clickEvents.recordingId, recordingId))
      .orderBy(clickEvents.timestampMs);
  }

  /** Match both IDs so a screenshot lookup cannot cross recording ownership. */
  async getClick(recordingId: string, clickId: string): Promise<ClickEvent | null> {
    const click = await this.db.query.clickEvents.findFirst({
      where: (table, { and, eq: equals }) =>
        and(equals(table.recordingId, recordingId), equals(table.id, clickId)),
    });

    return click ?? null;
  }

  async deleteClick(recordingId: string, id: string): Promise<void> {
    const deleted = await this.db
      .delete(clickEvents)
      .where(and(eq(clickEvents.recordingId, recordingId), eq(clickEvents.id, id)))
      .returning({ id: clickEvents.id });

    if (deleted.length === 0) throw new Error(`Click event not found: ${id}`);
  }

  async updateClickDescription(
    recordingId: string,
    id: string,
    actionDescription: string,
  ): Promise<ClickEvent> {
    const [click] = await this.db
      .update(clickEvents)
      .set({ actionDescription })
      .where(and(eq(clickEvents.recordingId, recordingId), eq(clickEvents.id, id)))
      .returning();

    if (!click) throw new Error(`Click event not found: ${id}`);

    return click;
  }

  async getDocument(recordingId: string): Promise<PersistedGuide | null> {
    const [document] = await this.db
      .select()
      .from(documents)
      .where(eq(documents.recordingId, recordingId))
      .orderBy(desc(documents.updatedAt))
      .limit(1);

    if (!document) return null;

    return {
      recordingId: document.recordingId,
      title: document.title,
      markdown: document.markdown,
      updatedAt: document.updatedAt,
    };
  }

  /** One Markdown document per recording; a later save replaces the earlier draft. */
  async saveDocument(recordingId: string, markdown: string): Promise<PersistedGuide> {
    const session = await this.get(recordingId);

    if (!session) throw new RecordingNotFoundError(recordingId);

    const existing = await this.getDocument(recordingId);
    const now = new Date().toISOString();

    if (existing) {
      const [updated] = await this.db
        .update(documents)
        .set({ title: session.title, markdown, updatedAt: now })
        .where(eq(documents.recordingId, recordingId))
        .returning();

      if (!updated) throw new Error(`Guide document not found for recording: ${recordingId}`);

      return {
        recordingId: updated.recordingId,
        title: updated.title,
        markdown: updated.markdown,
        updatedAt: updated.updatedAt,
      };
    }

    const [created] = await this.db
      .insert(documents)
      .values({
        id: randomUUID(),
        recordingId,
        title: session.title,
        format: "help-guide",
        language: "en",
        markdown,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!created) throw new Error("Failed to save guide document");

    return {
      recordingId: created.recordingId,
      title: created.title,
      markdown: created.markdown,
      updatedAt: created.updatedAt,
    };
  }

  /** Foreign-key cascades remove activity rows; this does not delete filesystem assets. */
  async delete(id: string): Promise<void> {
    await this.db.delete(recordings).where(eq(recordings.id, id));
  }
}
