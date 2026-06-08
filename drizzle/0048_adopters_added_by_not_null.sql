-- v2.19.9: enforce adopters.added_by NOT NULL at the DB layer.
--
-- Background: Drizzle schema at src/db/schema.ts:21 has had `default("anonymous")`
-- forever, and every application code path that inserts an adopter funnels
-- through saveAdopter / _adopterFactory / /api/adopters POST — all of which
-- either supply a real email or fall back to the literal 'anonymous'. So
-- prod + staging carry zero NULL rows today, and there are no active code
-- paths that would create one.
--
-- BUT the column was structurally nullable. Anyone running raw SQL via
-- wrangler against D1, or a future Drizzle update that passes explicit
-- `null`, could silently produce a NULL row that then renders as an
-- unresolvable creator in the v2.19.6 Created-by column. v2.19.8 added a
-- client-side guard for that; this migration removes the underlying foot-
-- gun so the guard never needs to fire.
--
-- SQLite doesn't support `ALTER TABLE ... ALTER COLUMN`, so we rebuild
-- the table using the standard temp-table / copy / drop / rename dance.
-- Same pattern migration 0003_greedy_frog_thor.sql established for the
-- earlier added_by → 'anonymous' default rollout.
--
-- Pre-flight: belt-and-suspenders backfill in case any NULL did sneak in
-- between the count we ran and this migration applying. Idempotent on
-- a clean DB.

UPDATE adopters SET added_by = 'anonymous' WHERE added_by IS NULL;
--> statement-breakpoint

PRAGMA foreign_keys=OFF;
--> statement-breakpoint

-- Mirror the current adopters shape with the NOT NULL constraint on
-- added_by. Every column included so the copy preserves all data.
-- ── Keep this column list in sync with src/db/schema.ts whenever the
-- table grows. As of 2026-06-08: id, name, contact_info, contact_entries,
-- address_info, family_members, notes, created_at, updated_at, status,
-- added_by, source_url, country, token_hash, deleted_at, source, is_public.
-- IMPORTANT: column DEFAULTs here mirror the ACTUAL prod/staging schema as
-- verified via PRAGMA table_info(adopters) on 2026-06-08, NOT the values
-- in src/db/schema.ts. There's historical drift on `status` — prod has
-- DEFAULT 'good' while the schema TS file says '5'. Preserving prod
-- reality keeps this migration scoped to the added_by NOT NULL change
-- the user actually asked for. Unwinding the wider drift belongs in a
-- separate, deliberate migration. (Status default never fires in
-- practice anyway — every saveAdopter sets it explicitly per the v37
-- avgRating switchover.)
CREATE TABLE IF NOT EXISTS `__new_adopters` (
    `id` text PRIMARY KEY NOT NULL,
    `name` text NOT NULL,
    `contact_info` text,
    `contact_entries` text,
    `address_info` text,
    `family_members` text,
    `notes` text,
    `created_at` integer DEFAULT (strftime('%s', 'now')),
    `updated_at` integer DEFAULT (strftime('%s', 'now')),
    `status` text DEFAULT 'good',
    `added_by` text NOT NULL DEFAULT 'anonymous',
    `source_url` text,
    `country` text,
    `token_hash` text,
    `deleted_at` integer,
    `source` text NOT NULL DEFAULT 'manual',
    `is_public` integer NOT NULL DEFAULT 0
);
--> statement-breakpoint

INSERT INTO `__new_adopters` (
    `id`, `name`, `contact_info`, `contact_entries`, `address_info`, `family_members`, `notes`,
    `created_at`, `updated_at`, `status`, `added_by`, `source_url`, `country`,
    `token_hash`, `deleted_at`, `source`, `is_public`
)
SELECT
    `id`, `name`, `contact_info`, `contact_entries`, `address_info`, `family_members`, `notes`,
    `created_at`, `updated_at`, `status`,
    COALESCE(`added_by`, 'anonymous'),  -- defense-in-depth, mirrors the UPDATE above
    `source_url`, `country`,
    `token_hash`, `deleted_at`, `source`, `is_public`
FROM `adopters`;
--> statement-breakpoint

DROP TABLE `adopters`;
--> statement-breakpoint
ALTER TABLE `__new_adopters` RENAME TO `adopters`;
--> statement-breakpoint

-- Recreate the only application-level index on the table. Drizzle's table()
-- mapping at src/db/schema.ts:46-48 declares this; the rebuild dropped it
-- along with the original table.
CREATE INDEX IF NOT EXISTS `name_idx` ON `adopters` (`name`);
--> statement-breakpoint

PRAGMA foreign_keys=ON;
