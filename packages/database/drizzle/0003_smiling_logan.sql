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
	`file_name` text NOT NULL,
	`offset_ms` integer DEFAULT 0 NOT NULL,
	`unreadable_line_count` integer DEFAULT 0 NOT NULL,
	`imported_at` text NOT NULL,
	FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `timeline_imports_recording_kind_idx` ON `timeline_imports` (`recording_id`,`kind`);--> statement-breakpoint
ALTER TABLE `recordings` ADD `media_started_at` text;--> statement-breakpoint
ALTER TABLE `recordings` ADD `media_pauses_json` text;