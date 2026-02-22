CREATE TABLE IF NOT EXISTS `account` (
	`userId` text NOT NULL,
	`type` text NOT NULL,
	`provider` text NOT NULL,
	`providerAccountId` text NOT NULL,
	`refresh_token` text,
	`access_token` text,
	`expires_at` integer,
	`token_type` text,
	`scope` text,
	`id_token` text,
	`session_state` text,
	PRIMARY KEY(`provider`, `providerAccountId`),
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `session` (
	`sessionToken` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`expires` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`email` text NOT NULL,
	`emailVerified` integer,
	`image` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `verificationToken` (
	`identifier` text NOT NULL,
	`token` text NOT NULL,
	`expires` integer NOT NULL,
	PRIMARY KEY(`identifier`, `token`)
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `__new_adoptions` (
	`id` text PRIMARY KEY NOT NULL,
	`adopter_id` text,
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
INSERT OR IGNORE INTO `__new_adoptions`("id", "adopter_id", "animal_name", "species", "details", "status", "rating", "comments", "date", "added_by") SELECT "id", "adopter_id", "animal_name", "species", "details", "status", "rating", "comments", "date", "added_by" FROM `adoptions`;--> statement-breakpoint
DROP TABLE IF EXISTS `adoptions`;--> statement-breakpoint
ALTER TABLE `__new_adoptions` RENAME TO `adoptions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `adopters` ADD `added_by` text DEFAULT 'anonymous';