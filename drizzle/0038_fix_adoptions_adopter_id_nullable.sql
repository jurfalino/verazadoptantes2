-- Drop the residual NOT NULL constraint on adoptions.adopter_id in production.
--
-- Background: migration 0002 was supposed to recreate `adoptions` with a
-- nullable `adopter_id` (so "available" records — animals not yet linked to
-- an adopter — can be inserted). On the staging DB it landed correctly; on
-- prod the rebuild never took effect, leaving `adopter_id text NOT NULL`
-- from the original 0000 schema. As of v2.12.x the adoption form sends
-- `adopter_id = NULL` when record_type='available', and prod inserts fail
-- with a NOT NULL constraint violation.
--
-- This migration repeats the table-rebuild dance against the *current*
-- column set (22 columns, including all post-0002 additions through 0035),
-- so it converges any DB whose adopter_id is still NOT NULL onto the
-- intended nullable shape. On staging (already nullable) it is a no-op in
-- effect — same column set, same data — just a rebuild.
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_adoptions` (
	`id` text PRIMARY KEY NOT NULL,
	`adopter_id` text,
	`animal_name` text,
	`species` text,
	`details` text,
	`status` text,
	`rating` integer,
	`comments` text,
	`date` integer,
	`added_by` text DEFAULT 'anonymous',
	`on_behalf_of` text,
	`delivered_to_home` integer,
	`verified_address` text,
	`identity_verified` integer,
	`record_type` text DEFAULT 'adoption',
	`source_url` text,
	`age` text,
	`sex` text,
	`color` text,
	`microchip` text,
	`estimated_birth_date` integer,
	`neutered` integer
);
--> statement-breakpoint
INSERT INTO `__new_adoptions` (
	`id`, `adopter_id`, `animal_name`, `species`, `details`, `status`, `rating`,
	`comments`, `date`, `added_by`, `on_behalf_of`, `delivered_to_home`,
	`verified_address`, `identity_verified`, `record_type`, `source_url`, `age`,
	`sex`, `color`, `microchip`, `estimated_birth_date`, `neutered`
)
SELECT
	`id`, `adopter_id`, `animal_name`, `species`, `details`, `status`, `rating`,
	`comments`, `date`, `added_by`, `on_behalf_of`, `delivered_to_home`,
	`verified_address`, `identity_verified`, `record_type`, `source_url`, `age`,
	`sex`, `color`, `microchip`, `estimated_birth_date`, `neutered`
FROM `adoptions`;
--> statement-breakpoint
DROP TABLE `adoptions`;
--> statement-breakpoint
ALTER TABLE `__new_adoptions` RENAME TO `adoptions`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
