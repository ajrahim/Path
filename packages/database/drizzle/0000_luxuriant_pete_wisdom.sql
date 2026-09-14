CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` text NOT NULL
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
	`created_at` text NOT NULL,
	FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `click_recording_time_idx` ON `click_events` (`recording_id`,`timestamp_ms`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`recording_id` text NOT NULL,
	`title` text NOT NULL,
	`format` text NOT NULL,
	`language` text NOT NULL,
	`markdown` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `documents_recording_idx` ON `documents` (`recording_id`);--> statement-breakpoint
CREATE TABLE `recordings` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`capture_mode` text NOT NULL,
	`capture_region_json` text,
	`video_path` text,
	`audio_path` text,
	`thumbnail_path` text,
	`duration_ms` integer,
	`transcript_status` text DEFAULT 'pending' NOT NULL,
	`guide_status` text DEFAULT 'none' NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `recordings_created_at_idx` ON `recordings` (`created_at`);--> statement-breakpoint
CREATE INDEX `recordings_status_idx` ON `recordings` (`status`);--> statement-breakpoint
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