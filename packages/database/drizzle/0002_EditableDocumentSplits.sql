ALTER TABLE `document_collections` ADD `workflow_plan` text;--> statement-breakpoint
ALTER TABLE `document_collections` ADD `plan_version` integer DEFAULT 0 NOT NULL;