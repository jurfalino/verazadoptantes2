-- Form answers sent with an API adoption request (activity.formContent), any
-- JSON shape, stored as sent. Keyed by the activity (adopter_events.id); no
-- adopter column, so a profile merge never leaves it pointing at the old one.
CREATE TABLE IF NOT EXISTS `activity_forms` (
    `activity_id` text PRIMARY KEY NOT NULL,
    `form_content` text NOT NULL,
    `source` text DEFAULT 'api' NOT NULL,
    `added_by` text,
    `created_at` integer DEFAULT (strftime('%s', 'now'))
);
--> statement-breakpoint
-- Contact entries an API call added to a known person's profile
-- (JSON [{ entryId, field }]), so voiding the call can take them back.
ALTER TABLE `api_requests` ADD `contacts_added` text;
