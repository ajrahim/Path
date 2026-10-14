CREATE TABLE `document_collections` (
	`recording_id` text PRIMARY KEY NOT NULL,
	`mode` text DEFAULT 'combine' NOT NULL,
	FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
DROP INDEX `documents_recording_id_unique`;--> statement-breakpoint
ALTER TABLE `documents` ADD `title` text DEFAULT 'Document' NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `position` integer DEFAULT 0;--> statement-breakpoint
CREATE UNIQUE INDEX `documents_recording_position_idx` ON `documents` (`recording_id`,`position`);