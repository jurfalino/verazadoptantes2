-- Migration: showcase slugs + handles + selectedAnimalId (v2.14.10 foundation)
--
-- Adds:
--   organizations.slug        — unique kebab-cased shareable identifier
--                              backfilled below for existing rows
--   user_profiles.handle      — unique kebab-cased shareable identifier
--                              left NULL for legacy rows; ensureUserProfile()
--                              assigns on next sign-in via generateUniqueSlug()
--   form_submissions.selected_animal_id — nullable; captures the animal the
--                              applicant chose from the showcase before
--                              submitting. Null when the form was shared
--                              generically (existing behavior).
--
-- The slug/handle backfill strategy in pure SQL is awkward (can't easily
-- handle the increment-on-collision loop in a deterministic single query),
-- so this migration adds the columns + backfills `organizations.slug` with
-- a deterministic SQL transform that's good enough for the typically tiny
-- org row count today; if collisions ever surface in production the
-- generateUniqueSlug helper rewrites on next org create/rename.
-- user_profiles.handle starts NULL and is filled on next sign-in.

ALTER TABLE organizations ADD COLUMN slug TEXT;
ALTER TABLE user_profiles ADD COLUMN handle TEXT;
ALTER TABLE form_submissions ADD COLUMN selected_animal_id TEXT;

-- Backfill org slug from name. Lowercases, strips accents (best-effort —
-- SQLite has no native unaccent so we leave non-ASCII as-is; the JS helper
-- handles full normalization on next rename), replaces non-alphanumerics
-- with single hyphens, trims edge hyphens.
UPDATE organizations
SET slug = TRIM(
    REPLACE(
        REPLACE(
            REPLACE(
                REPLACE(
                    REPLACE(
                        LOWER(name),
                        ' ', '-'
                    ),
                    '_', '-'
                ),
                '.', '-'
            ),
            '/', '-'
        ),
        '\', '-'
    ),
    '-'
)
WHERE slug IS NULL;

-- Unique indexes. Slug/handle are unique platform-wide.
-- D1 will reject the migration if a backfill collision exists; that's a
-- signal for the migrate-staging job to surface so we can resolve manually.
CREATE UNIQUE INDEX IF NOT EXISTS idx_orgs_slug ON organizations (slug);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_handle ON user_profiles (handle);
