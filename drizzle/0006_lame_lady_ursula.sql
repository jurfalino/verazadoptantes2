-- Idempotent: tables/indexes may already exist from later migrations (e.g. 0012, 0014, 0020, 0022)
CREATE TABLE IF NOT EXISTS `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`user_email` text,
	`action` text NOT NULL,
	`target` text,
	`details` text,
	`device` text,
	`is_pwa` integer DEFAULT 0,
	`ip_address` text,
	`created_at` integer DEFAULT (strftime('%s', 'now'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_audit_user` ON `audit_log` (`user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_audit_action` ON `audit_log` (`action`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_audit_created` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `data_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`adopter_id` text,
	`requester_name` text NOT NULL,
	`requester_email` text,
	`request_type` text DEFAULT 'inaccuracy' NOT NULL,
	`details` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')),
	`resolved_at` integer,
	`resolved_by` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `duplicate_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`adopter1_id` text NOT NULL,
	`adopter2_id` text NOT NULL,
	`match_types` text NOT NULL,
	`match_values` text,
	`score` integer NOT NULL,
	`confidence` text NOT NULL,
	`status` text DEFAULT 'pending',
	`detected_at` integer DEFAULT (strftime('%s', 'now')),
	`resolved_at` integer,
	`resolved_by` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `duplicate_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`adopter_id` text NOT NULL,
	`token_type` text NOT NULL,
	`token_value` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_dup_token` ON `duplicate_tokens` (`token_type`,`token_value`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_dup_adopter` ON `duplicate_tokens` (`adopter_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `form_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`phone` text,
	`address` text,
	`latitude` text,
	`longitude` text,
	`selfie_url` text,
	`species` text,
	`life_stage` text,
	`special_needs` integer DEFAULT 0,
	`intent` text,
	`household` text,
	`status` text DEFAULT 'pending',
	`linked_adopter_id` text,
	`notification_id` text,
	`created_at` integer DEFAULT (strftime('%s', 'now'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_form_user` ON `form_submissions` (`user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_form_status` ON `form_submissions` (`status`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text DEFAULT 'contract_result' NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`url` text,
	`icon` text DEFAULT '📋',
	`read` integer DEFAULT 0,
	`metadata` text,
	`created_at` integer DEFAULT (strftime('%s', 'now')),
	`expires_at` integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_notif_user` ON `notifications` (`user_id`,`read`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `user_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`organization` text,
	`role` text DEFAULT 'viewer',
	`notes` text,
	`comms_opt_in` integer DEFAULT 0,
	`country` text,
	`country_confirmed` integer DEFAULT 0,
	`last_active_at` integer,
	`created_at` integer DEFAULT (strftime('%s', 'now'))
);
--> statement-breakpoint
DROP TABLE IF EXISTS `adoption_images`;--> statement-breakpoint
-- Columns below may already exist; SQLite has no ADD COLUMN IF NOT EXISTS — no-op to avoid duplicate column errors on re-run
SELECT 1;--> statement-breakpoint
SELECT 1;--> statement-breakpoint
SELECT 1;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_stats_user` ON `adopter_stats` (`user_id`);--> statement-breakpoint
SELECT 1;--> statement-breakpoint
SELECT 1;--> statement-breakpoint
SELECT 1;--> statement-breakpoint
SELECT 1;--> statement-breakpoint
SELECT 1;--> statement-breakpoint
SELECT 1;--> statement-breakpoint
SELECT 1;--> statement-breakpoint
SELECT 1;--> statement-breakpoint
SELECT 1;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `searches_query_unique` ON `searches` (`query`);
