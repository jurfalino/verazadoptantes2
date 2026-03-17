ALTER TABLE `adopter_images` ADD `is_profile_picture` integer DEFAULT 0;
ALTER TABLE `adopters` ADD `source_url` text;
ALTER TABLE `adoptions` ADD `delivered_to_home` integer;
ALTER TABLE `adoptions` ADD `verified_address` text;
ALTER TABLE `adoptions` ADD `identity_verified` integer;