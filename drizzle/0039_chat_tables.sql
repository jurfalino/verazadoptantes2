-- Support chat: floating widget routed through Telegram bot.
-- Two tables; no rebuilds, no FKs, no destructive changes.
-- Conversation id is generated client-side (UUID v4) and used as a stable
-- localStorage anchor; first 8 hex chars are embedded in every Telegram
-- forwarded message so admin replies (via Telegram's Reply gesture) can be
-- routed back to the right conversation in the webhook handler.

CREATE TABLE `chat_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_email` text,
	`user_label` text,
	`created_at` integer DEFAULT (strftime('%s', 'now')),
	`last_message_at` integer,
	`blocked` integer DEFAULT 0,
	`hour_count` integer DEFAULT 0,
	`hour_window_start` integer
);
--> statement-breakpoint
CREATE INDEX `idx_chat_conv_last` ON `chat_conversations` (`last_message_at`);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`direction` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')),
	`telegram_message_id` integer
);
--> statement-breakpoint
CREATE INDEX `idx_chat_msgs_conv` ON `chat_messages` (`conversation_id`);
--> statement-breakpoint
CREATE INDEX `idx_chat_msgs_conv_created` ON `chat_messages` (`conversation_id`, `created_at`);
