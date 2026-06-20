-- v2.19.58: backfill `adopters.is_public = 1` on every record whose
-- `source_url` is a real http(s) URL. The provenance argument is identical
-- whether the URL came from the ImportWizard (`source='imported'`) or the
-- manual new-adopter form (`source='manual'`) — either way, the data is on
-- the open internet, which is the entire premise of the public-profile
-- bypass.
--
-- DB survey at write time:
--   staging: 10 rows match (1 imported + 9 manual)
--   prod:    35 rows match (0 imported + 35 manual)
-- The strict `source='imported'` filter would have caught only Patricia
-- Núñez on staging and zero rows on prod, missing the actual case the user
-- was reporting.
--
-- Idempotent: rows already at 1 are skipped via the `is_public = 0`
-- predicate. No-op against a clean state.
--
-- IMPORTANT: setting `is_public = 1` is a passive data-correctness change
-- under ENABLE_PUBLIC_PROFILES = OFF — the masking bypass in
-- `buildMaskOptions` requires BOTH the flag AND the row-level field.
-- Flipping the flag on later will activate the bypass on every row this
-- migration touches; the v2.19.58 ship explicitly DOES NOT flip the flag.
-- That decision (A2 vs A2-mod) is a separate planned conversation.

UPDATE adopters
SET is_public = 1
WHERE is_public = 0
  AND source_url IS NOT NULL
  AND source_url LIKE 'https://%';
