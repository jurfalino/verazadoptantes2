CREATE TABLE IF NOT EXISTS `adopter_stats` (
	`id` text PRIMARY KEY NOT NULL,
	`adopter_id` text NOT NULL,
	`event_type` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_stats_adopter` ON `adopter_stats` (`adopter_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_stats_created` ON `adopter_stats` (`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `adoption_images` (
	`id` text PRIMARY KEY NOT NULL,
	`adoption_id` text NOT NULL,
	`url` text NOT NULL,
	`caption` text,
	`uploaded_at` integer DEFAULT (strftime('%s', 'now')),
	`added_by` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_adoption_images` ON `adoption_images` (`adoption_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `app_config` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now')),
	`updated_by` text
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `__new_adopters` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`contact_info` text,
	`address_info` text,
	`family_members` text,
	`created_at` integer DEFAULT (strftime('%s', 'now')),
	`updated_at` integer DEFAULT (strftime('%s', 'now')),
	`status` text DEFAULT '5',
	`added_by` text DEFAULT 'anonymous'
);
--> statement-breakpoint
INSERT OR IGNORE INTO `__new_adopters`("id", "name", "contact_info", "address_info", "family_members", "created_at", "updated_at", "status", "added_by") SELECT "id", "name", "contact_info", "address_info", "family_members", "created_at", "updated_at", "status", "added_by" FROM `adopters`;--> statement-breakpoint
DROP TABLE IF EXISTS `adopters`;--> statement-breakpoint
ALTER TABLE `__new_adopters` RENAME TO `adopters`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `name_idx` ON `adopters` (`name`);--> statement-breakpoint
ALTER TABLE `adopter_images` ADD `adoption_id` text;--> statement-breakpoint
ALTER TABLE `adoptions` ADD `on_behalf_of` text;--> statement-breakpoint
ALTER TABLE `adoptions` ADD `record_type` text DEFAULT 'adoption';