CREATE TABLE `adopter_history` (
	`id` text PRIMARY KEY NOT NULL,
	`adopter_id` text NOT NULL,
	`changed_by` text DEFAULT 'anonymous',
	`changes` text,
	`changed_at` integer DEFAULT (strftime('%s', 'now'))
);
--> statement-breakpoint
CREATE TABLE `adopters` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`email` text,
	`address` text,
	`socials` text,
	`created_at` integer DEFAULT (strftime('%s', 'now')),
	`updated_at` integer DEFAULT (strftime('%s', 'now')),
	`status` text DEFAULT 'good'
);
--> statement-breakpoint
CREATE INDEX `name_idx` ON `adopters` (`name`);--> statement-breakpoint
CREATE INDEX `phone_idx` ON `adopters` (`phone`);--> statement-breakpoint
CREATE TABLE `adoptions` (
	`id` text PRIMARY KEY NOT NULL,
	`adopter_id` text NOT NULL,
	`animal_name` text,
	`details` text,
	`status` text,
	`rating` integer,
	`comments` text,
	`date` integer
);
--> statement-breakpoint
CREATE TABLE `searches` (
	`id` text PRIMARY KEY NOT NULL,
	`query` text NOT NULL,
	`type` text DEFAULT 'general',
	`count` integer DEFAULT 1,
	`last_searched_at` integer DEFAULT (strftime('%s', 'now'))
);
