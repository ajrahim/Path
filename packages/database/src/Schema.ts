import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  foreignKey,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type {
  CaptureMode,
  CaptureRegion,
  DocumentRevisionKind,
  MediaPause,
  MouseButton,
  RecordingStatus,
  TimelineImportKind,
  TranscriptStatus,
} from "@path/shared";

/** Directories that hold recording assets; earlier roots stay registered after a location change. */
export const storageRoots = sqliteTable("storage_roots", {
  id: text("id").primaryKey(),
  path: text("path").notNull().unique(),
  createdAt: text("created_at").notNull(),
});

/** Durable metadata only; large media assets live in `<storage root>/<recording id>/`. */
export const recordings = sqliteTable(
  "recordings",
  {
    id: text("id").primaryKey(),
    storageRootId: text("storage_root_id")
      .notNull()
      .references(() => storageRoots.id),
    title: text("title").notNull(),
    status: text("status").$type<RecordingStatus>().notNull(),
    captureMode: text("capture_mode").$type<CaptureMode>().notNull(),
    captureRegionJson: text("capture_region_json", { mode: "json" }).$type<CaptureRegion | null>(),

    videoPath: text("video_path"),
    audioPath: text("audio_path"),
    thumbnailPath: text("thumbnail_path"),
    durationMs: integer("duration_ms"),

    transcriptStatus: text("transcript_status")
      .$type<TranscriptStatus>()
      .notNull()
      .default("pending"),

    startedAt: text("started_at").notNull(),
    // Wall-clock media zero and pauses, stored when capture stops.
    mediaStartedAt: text("media_started_at"),
    mediaPausesJson: text("media_pauses_json", { mode: "json" }).$type<MediaPause[] | null>(),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("recordings_created_at_idx").on(table.createdAt),
    index("recordings_status_idx").on(table.status),
    index("recordings_storage_root_idx").on(table.storageRootId),
  ],
);

/** Transcript edits update these rows without rewriting the provider's raw JSON output. */
export const transcriptSegments = sqliteTable(
  "transcript_segments",
  {
    id: text("id").primaryKey(),
    recordingId: text("recording_id")
      .notNull()
      .references(() => recordings.id, { onDelete: "cascade" }),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    text: text("text").notNull(),
    speaker: text("speaker"),
    confidence: real("confidence"),
  },
  (table) => [index("transcript_recording_time_idx").on(table.recordingId, table.startMs)],
);

/** Preserve original and derived coordinate spaces so stored clicks remain interpretable. */
export const clickEvents = sqliteTable(
  "click_events",
  {
    id: text("id").primaryKey(),
    recordingId: text("recording_id")
      .notNull()
      .references(() => recordings.id, { onDelete: "cascade" }),
    timestampMs: integer("timestamp_ms").notNull(),
    button: text("button").$type<MouseButton>().notNull(),

    globalX: real("global_x").notNull(),
    globalY: real("global_y").notNull(),
    displayId: text("display_id").notNull(),
    displayX: real("display_x").notNull(),
    displayY: real("display_y").notNull(),
    captureX: real("capture_x"),
    captureY: real("capture_y"),
    videoX: real("video_x"),
    videoY: real("video_y"),
    normalizedX: real("normalized_x"),
    normalizedY: real("normalized_y"),
    recordingFrameWidth: integer("recording_frame_width"),
    recordingFrameHeight: integer("recording_frame_height"),
    insideCaptureRegion: integer("inside_capture_region", { mode: "boolean" }).notNull(),

    screenshotPath: text("screenshot_path"),
    actionDescription: text("action_description"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("click_recording_time_idx").on(table.recordingId, table.timestampMs)],
);

/**
 * One document per recording. The saved revision is the last explicit save; the draft version
 * advances on every draft change so a stale editor cannot overwrite newer unsaved text.
 */
export const documents = sqliteTable(
  "documents",
  {
    id: text("id").primaryKey(),
    recordingId: text("recording_id")
      .notNull()
      .unique()
      .references(() => recordings.id, { onDelete: "cascade" }),
    savedRevisionNumber: integer("saved_revision_number"),
    savedAt: text("saved_at"),
    draftVersion: integer("draft_version").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // A saved pointer must name a revision of this same document.
    foreignKey({
      columns: [table.id, table.savedRevisionNumber],
      foreignColumns: [documentRevisions.documentId, documentRevisions.number],
    }),
  ],
);

/** Append-only snapshots; embedded data-URL images are stored once in `document_images`. */
export const documentRevisions = sqliteTable(
  "document_revisions",
  {
    // Annotated because documents also references this table through its saved revision.
    documentId: text("document_id")
      .notNull()
      .references((): AnySQLiteColumn => documents.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    kind: text("kind").$type<DocumentRevisionKind>().notNull(),
    contentHash: text("content_hash").notNull(),
    body: text("body").notNull(),
    bodyEncoding: text("body_encoding").$type<DocumentBodyEncoding>().notNull(),
    characterCount: integer("character_count").notNull(),
    restoredFromNumber: integer("restored_from_number"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.documentId, table.number] }),
    index("document_revisions_hash_idx").on(table.documentId, table.contentHash),
  ],
);

export type DocumentBodyEncoding = "plain" | "image-refs";

/** Content-addressed embedded images shared by every revision of one document. */
export const documentImages = sqliteTable(
  "document_images",
  {
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    hash: text("hash").notNull(),
    dataUrl: text("data_url").notNull(),
  },
  (table) => [primaryKey({ columns: [table.documentId, table.hash] })],
);

/** Unsaved editor text that survives restarts; it exists only while it differs from the save. */
export const documentDrafts = sqliteTable("document_drafts", {
  documentId: text("document_id")
    .primaryKey()
    .references(() => documents.id, { onDelete: "cascade" }),
  markdown: text("markdown").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type TimelineImportState = "staging" | "ready";

/**
 * One ready import per recording and kind. A replacement streams into a staging import and is
 * promoted in one transaction, so readers never observe a partially written file.
 */
export const timelineImports = sqliteTable(
  "timeline_imports",
  {
    id: text("id").primaryKey(),
    recordingId: text("recording_id")
      .notNull()
      .references(() => recordings.id, { onDelete: "cascade" }),
    kind: text("kind").$type<TimelineImportKind>().notNull(),
    state: text("state").$type<TimelineImportState>().notNull(),
    fileName: text("file_name").notNull(),
    offsetMs: integer("offset_ms").notNull().default(0),
    rowCount: integer("row_count").notNull().default(0),
    unreadableLineCount: integer("unreadable_line_count").notNull().default(0),
    importedAt: text("imported_at").notNull(),
  },
  (table) => [
    uniqueIndex("timeline_imports_ready_kind_idx")
      .on(table.recordingId, table.kind)
      .where(sql`state = 'ready'`),
    index("timeline_imports_state_idx").on(table.state),
  ],
);

/** Rows keep their original wall-clock time so offset changes re-align them without re-import. */
export const timelineImportEntries = sqliteTable(
  "timeline_import_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    importId: text("import_id")
      .notNull()
      .references(() => timelineImports.id, { onDelete: "cascade" }),
    occurredAtMs: integer("occurred_at_ms").notNull(),
    text: text("text").notNull(),
  },
  (table) => [index("timeline_import_entries_time_idx").on(table.importId, table.occurredAtMs)],
);

/**
 * Managed files whose database rows are already gone. The intent is written in the same
 * transaction as the row deletion, so a locked or interrupted file removal is retried later.
 */
export const assetDeletions = sqliteTable("asset_deletions", {
  path: text("path").primaryKey(),
  isDirectory: integer("is_directory", { mode: "boolean" }).notNull(),
  requestedAt: text("requested_at").notNull(),
  attemptCount: integer("attempt_count").notNull().default(0),
});

/** JSON values stay untyped here so their owning service controls validation. */
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json", { mode: "json" }).$type<unknown>().notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
});

export const projectRecordings = sqliteTable(
  "project_recordings",
  {
    recordingId: text("recording_id")
      .primaryKey()
      .references(() => recordings.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
  },
  (table) => [index("project_recordings_project_idx").on(table.projectId)],
);

export type RecordingRow = typeof recordings.$inferSelect;
