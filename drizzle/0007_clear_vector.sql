CREATE TABLE `org_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_by` text NOT NULL,
	`expires_at` integer,
	`created_at` integer DEFAULT (strftime('%s', 'now'))
);
--> statement-breakpoint
CREATE INDEX `idx_org_invite_org` ON `org_invites` (`org_id`);--> statement-breakpoint
CREATE TABLE `org_members` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`user_email` text NOT NULL,
	`role` text DEFAULT 'member',
	`joined_at` integer DEFAULT (strftime('%s', 'now'))
);
--> statement-breakpoint
CREATE INDEX `idx_org_member_unique` ON `org_members` (`org_id`,`user_email`);--> statement-breakpoint
CREATE INDEX `idx_org_member_email` ON `org_members` (`user_email`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now'))
);
--> statement-breakpoint
ALTER TABLE `notifications` ADD `dismissed` integer DEFAULT 0;--> statement-breakpoint
CREATE INDEX `idx_notif_type` ON `notifications` (`type`,`created_at`);--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `province` text;--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `province_code` text;--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `city` text;--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `timezone` text;