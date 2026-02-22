CREATE TABLE IF NOT EXISTS `adopter_flags` (
	`id` text PRIMARY KEY NOT NULL,
	`adopter_id` text NOT NULL,
	`flagged_by` text DEFAULT 'anonymous',
	`reason` text DEFAULT 'duplicate',
	`target_adopter_id` text,
	`details` text,
	`created_at` integer DEFAULT (strftime('%s', 'now'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `adopter_history` (
	`id` text PRIMARY KEY NOT NULL,
	`adopter_id` text NOT NULL,
	`changed_by` text DEFAULT 'anonymous',
	`changes` text,
	`changed_at` integer DEFAULT (strftime('%s', 'now'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `adopter_images` (
	`id` text PRIMARY KEY NOT NULL,
	`adopter_id` text NOT NULL,
	`url` text NOT NULL,
	`caption` text,
	`uploaded_at` integer DEFAULT (strftime('%s', 'now')),
	`added_by` text DEFAULT 'anonymous'
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `adopters` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`contact_info` text,
	`address_info` text,
	`created_at` integer DEFAULT (strftime('%s', 'now')),
	`updated_at` integer DEFAULT (strftime('%s', 'now')),
	`status` text DEFAULT 'good'
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `name_idx` ON `adopters` (`name`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `adoptions` (
	`id` text PRIMARY KEY NOT NULL,
	`adopter_id` text NOT NULL,
	`animal_name` text,
	`species` text,
	`details` text,
	`status` text,
	`rating` integer,
	`comments` text,
	`date` integer,
	`added_by` text DEFAULT 'anonymous'
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `searches` (
	`id` text PRIMARY KEY NOT NULL,
	`query` text NOT NULL,
	`type` text DEFAULT 'general',
	`count` integer DEFAULT 1,
	`last_searched_at` integer DEFAULT (strftime('%s', 'now'))
);
