-- Normalization Phase 1 (create). Split the overloaded `adoptions` table into
-- animals (identity), placements (custody spans), adopter_events (adopter activity).
-- Backfill is a separate migration (0055). See
-- .agents/plans/animals-placements-normalization.md.
CREATE TABLE IF NOT EXISTS animals (
	id text PRIMARY KEY NOT NULL,
	name text,
	species text,
	details text,
	age text,
	estimated_birth_date integer,
	neutered integer,
	sex text,
	color text,
	microchip text,
	source_url text,
	added_by text DEFAULT 'anonymous',
	created_at integer DEFAULT (strftime('%s', 'now')),
	updated_at integer DEFAULT (strftime('%s', 'now')),
	deleted_at integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_animals_added_by ON animals (added_by);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS placements (
	id text PRIMARY KEY NOT NULL,
	animal_id text NOT NULL,
	adopter_id text NOT NULL,
	record_type text NOT NULL,
	started_at integer,
	ended_at integer,
	rating integer,
	status text,
	delivered_to_home integer,
	verified_address text,
	identity_verified integer,
	on_behalf_of text,
	comments text,
	source_url text,
	recorded_by text DEFAULT 'anonymous',
	created_at integer DEFAULT (strftime('%s', 'now'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_placements_animal ON placements (animal_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_placements_adopter ON placements (adopter_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_placements_active ON placements (animal_id, ended_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS adopter_events (
	id text PRIMARY KEY NOT NULL,
	adopter_id text NOT NULL,
	event_type text NOT NULL,
	animal_id text,
	placement_id text,
	animal_name text,
	species text,
	status text,
	rating integer,
	details text,
	date integer,
	on_behalf_of text,
	source_url text,
	recorded_by text DEFAULT 'anonymous',
	created_at integer DEFAULT (strftime('%s', 'now'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_events_adopter ON adopter_events (adopter_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_events_animal ON adopter_events (animal_id);
