-- Migration: Add adopter stats, app config, adoption types, and adoption images
-- Run after: 0002_milky_tenebrous.sql

-- Table: adopter_stats - Track profile events for analytics
CREATE TABLE IF NOT EXISTS `adopter_stats` (
	`id` text PRIMARY KEY NOT NULL,
	`adopter_id` text NOT NULL,
	`event_type` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_stats_adopter` ON `adopter_stats`(`adopter_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_stats_created` ON `adopter_stats`(`created_at`);
--> statement-breakpoint

-- Table: app_config - Admin-configurable settings
CREATE TABLE IF NOT EXISTS `app_config` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now')),
	`updated_by` text
);
--> statement-breakpoint

-- Initial config values
INSERT OR IGNORE INTO `app_config` (`key`, `value`) VALUES ('too_many_adoptions_threshold', '5');
--> statement-breakpoint
INSERT OR IGNORE INTO `app_config` (`key`, `value`) VALUES ('too_many_adoptions_period_days', '90');
--> statement-breakpoint

-- Table: adoption_images - Photos attached to adoption/observation records
CREATE TABLE IF NOT EXISTS `adoption_images` (
	`id` text PRIMARY KEY NOT NULL,
	`adoption_id` text NOT NULL,
	`url` text NOT NULL,
	`caption` text,
	`uploaded_at` integer DEFAULT (strftime('%s', 'now')),
	`added_by` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_adoption_images` ON `adoption_images`(`adoption_id`);
--> statement-breakpoint

-- Add record_type column to adoptions table
ALTER TABLE `adoptions` ADD `record_type` text DEFAULT 'adoption';
