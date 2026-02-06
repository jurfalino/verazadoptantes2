ALTER TABLE `adopter_images` ADD `is_profile_picture` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `adopters` ADD `source_url` text;--> statement-breakpoint
ALTER TABLE `adoptions` ADD `delivered_to_home` integer;--> statement-breakpoint
ALTER TABLE `adoptions` ADD `verified_address` text;--> statement-breakpoint
ALTER TABLE `adoptions` ADD `identity_verified` integer;