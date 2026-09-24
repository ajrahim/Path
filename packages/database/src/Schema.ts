import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type {
  CaptureRegion,
  CaptureMode,
  GuideFormat,
  GuideStatus,
  MediaPause,
  MouseButton,
  RecordingStatus,
  TimelineImportKind,
  TranscriptStatus,
} from "@path/shared";

/** Durable metadata only; large media assets remain in separately managed directories. */
export const recordings = sqliteTable(
  "recordings",
  {
    id: text("id").primaryKey(),
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
    guideStatus: text("guide_status").$type<GuideStatus>().notNull().default("none"),

    startedAt: text("started_at").notNull(),
    // Wall-clock media zero and pauses; null for recordings captured before timing was stored.
    mediaStartedAt: text("media_started_at"),
    mediaPausesJson: text("media_pauses_json", { mode: "json" }).$type<MediaPause[] | null>(),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("recordings_created_at_idx").on(table.createdAt),
    index("recordings_status_idx").on(table.status),
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

/** Persisted documents schema; the editor exports Markdown directly. */
export const documents = sqliteTable(
  "documents",
  {
    id: text("id").primaryKey(),
    recordingId: text("recording_id")
      .notNull()
      .references(() => recordings.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    format: text("format").$type<GuideFormat>().notNull(),
    language: text("language").notNull(),
    markdown: text("markdown").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("documents_recording_idx").on(table.recordingId)],
);

/** One imported log or element file per kind; a new import replaces the previous one. */
export const timelineImports = sqliteTable(
  "timeline_imports",
  {
    id: text("id").primaryKey(),
    recordingId: text("recording_id")
      .notNull()
      .references(() => recordings.id, { onDelete: "cascade" }),
    kind: text("kind").$type<TimelineImportKind>().notNull(),
    fileName: text("file_name").notNull(),
    offsetMs: integer("offset_ms").notNull().default(0),
    unreadableLineCount: integer("unreadable_line_count").notNull().default(0),
    importedAt: text("imported_at").notNull(),
  },
  (table) => [uniqueIndex("timeline_imports_recording_kind_idx").on(table.recordingId, table.kind)],
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

/** JSON values stay untyped here so their owning service controls validation and compatibility. */
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json", { mode: "json" }).$type<unknown>().notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type RecordingRow = typeof recordings.$inferSelect;
export type NewRecordingRow = typeof recordings.$inferInsert;

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
