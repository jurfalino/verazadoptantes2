-- v2.19.52: backfill historical `'Unknown'` literal strings in
-- `adoptions.animal_name` to NULL.
--
-- Background: two API routes — `api/adopters/route.ts:446` and
-- `api/adopters/[id]/add-record/route.ts:83` — coerced empty / missing
-- animal names to the English literal string `'Unknown'` before writing.
-- Combined with the wizard's now-removed "I don't know the name" toggle,
-- this meant the DB ended up with a mix of:
--   - real animal names ("Luna", "Toto", …)
--   - the literal string "Unknown" for any record where the rescuer
--     either flipped the toggle, didn't fill the field, or imported via
--     AI extraction that failed to find a name
--   - NULL for paths that already saved correctly
--
-- v2.19.52 also fixes the routes to write NULL instead of 'Unknown', so
-- new records land cleanly. This migration normalizes the historical
-- inconsistency so every "unknown" record is a NULL — making the
-- distinction meaningful, queries simpler, and the display-fallback
-- (`adoption.unnamed` → "Sin nombre") consistent everywhere.
--
-- Targets the literal English string only (the toggle's hardcoded value).
-- Real animals legitimately named "Unknown" / "unknown" would also match —
-- if any exist they're collateral, but on a Spanish-language vetting
-- registry the chance of an actual pet named "Unknown" is effectively
-- zero. We don't match case-insensitively or partial — only the exact
-- string the toggle/coercion wrote.
--
-- Idempotent: re-running is a no-op against a clean state (no rows match
-- `animal_name = 'Unknown'`).

UPDATE adoptions
SET animal_name = NULL,
    updated_at = strftime('%s', 'now') * 1000
WHERE animal_name = 'Unknown';
