CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `asset_deletions` (
	`path` text PRIMARY KEY NOT NULL,
	`is_directory` integer NOT NULL,
	`requested_at` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `click_events` (
	`id` text PRIMARY KEY NOT NULL,
	`recording_id` text NOT NULL,
	`timestamp_ms` integer NOT NULL,
	`button` text NOT NULL,
	`global_x` real NOT NULL,
	`global_y` real NOT NULL,
	`display_id` text NOT NULL,
	`display_x` real NOT NULL,
	`display_y` real NOT NULL,
	`capture_x` real,
	`capture_y` real,
	`video_x` real,
	`video_y` real,
	`normalized_x` real,
	`normalized_y` real,
	`recording_frame_width` integer,
	`recording_frame_height` integer,
	`inside_capture_region` integer NOT NULL,
	`screenshot_path` text,
	`action_description` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `click_recording_time_idx` ON `click_events` (`recording_id`,`timestamp_ms`);--> statement-breakpoint
CREATE TABLE `document_drafts` (
	`document_id` text PRIMARY KEY NOT NULL,
	`markdown` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `document_images` (
	`document_id` text NOT NULL,
	`hash` text NOT NULL,
	`data_url` text NOT NULL,
	PRIMARY KEY(`document_id`, `hash`),
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `document_revisions` (
	`document_id` text NOT NULL,
	`number` integer NOT NULL,
	`kind` text NOT NULL,
	`content_hash` text NOT NULL,
	`body` text NOT NULL,
	`body_encoding` text NOT NULL,
	`character_count` integer NOT NULL,
	`restored_from_number` integer,
	`created_at` text NOT NULL,
	PRIMARY KEY(`document_id`, `number`),
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `document_revisions_hash_idx` ON `document_revisions` (`document_id`,`content_hash`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`recording_id` text NOT NULL,
	`saved_revision_number` integer,
	`saved_at` text,
	`draft_version` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`id`,`saved_revision_number`) REFERENCES `document_revisions`(`document_id`,`number`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `documents_recording_id_unique` ON `documents` (`recording_id`);--> statement-breakpoint
CREATE TABLE `project_recordings` (
	`recording_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_recordings_project_idx` ON `project_recordings` (`project_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recordings` (
	`id` text PRIMARY KEY NOT NULL,
	`storage_root_id` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`capture_mode` text NOT NULL,
	`capture_region_json` text,
	`video_path` text,
	`audio_path` text,
	`thumbnail_path` text,
	`duration_ms` integer,
	`transcript_status` text DEFAULT 'pending' NOT NULL,
	`started_at` text NOT NULL,
	`media_started_at` text,
	`media_pauses_json` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`storage_root_id`) REFERENCES `storage_roots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `recordings_created_at_idx` ON `recordings` (`created_at`);--> statement-breakpoint
CREATE INDEX `recordings_status_idx` ON `recordings` (`status`);--> statement-breakpoint
CREATE INDEX `recordings_storage_root_idx` ON `recordings` (`storage_root_id`);--> statement-breakpoint
CREATE TABLE `storage_roots` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `storage_roots_path_unique` ON `storage_roots` (`path`);--> statement-breakpoint
CREATE TABLE `timeline_import_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`import_id` text NOT NULL,
	`occurred_at_ms` integer NOT NULL,
	`text` text NOT NULL,
	FOREIGN KEY (`import_id`) REFERENCES `timeline_imports`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `timeline_import_entries_time_idx` ON `timeline_import_entries` (`import_id`,`occurred_at_ms`);--> statement-breakpoint
CREATE TABLE `timeline_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`recording_id` text NOT NULL,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	`file_name` text NOT NULL,
	`offset_ms` integer DEFAULT 0 NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL,
	`unreadable_line_count` integer DEFAULT 0 NOT NULL,
	`imported_at` text NOT NULL,
	FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `timeline_imports_ready_kind_idx` ON `timeline_imports` (`recording_id`,`kind`) WHERE state = 'ready';--> statement-breakpoint
CREATE INDEX `timeline_imports_state_idx` ON `timeline_imports` (`state`);--> statement-breakpoint
CREATE TABLE `transcript_segments` (
	`id` text PRIMARY KEY NOT NULL,
	`recording_id` text NOT NULL,
	`start_ms` integer NOT NULL,
	`end_ms` integer NOT NULL,
	`text` text NOT NULL,
	`speaker` text,
	`confidence` real,
	FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `transcript_recording_time_idx` ON `transcript_segments` (`recording_id`,`start_ms`);