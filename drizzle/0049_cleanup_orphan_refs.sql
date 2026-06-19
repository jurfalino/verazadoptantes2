-- v2.19.50: clean up rows in FK-referencing tables whose adopter is gone.
--
-- Found during a senior-QA smoke pass:
--   - 4 rows in `adoptions` referencing adopter_ids that don't exist in
--     `adopters` (not soft-deleted via deleted_at — actually gone).
--   - 2 rows in `adopter_stats` in the same state.
--   - `adopter_history`, `duplicate_tokens`, `duplicate_candidates`,
--     `pii_access_requests`, `pii_access_grants` were all clean (verified at
--     audit time; the broad sweep below catches any future drift too).
--
-- Likely origin: a hard delete on `adopters` (via wrangler or an early
-- admin path) that didn't cascade. The schema doesn't enforce FK cascades
-- on these tables, so orphans accumulate silently. They don't crash anything
-- — joins just don't find rows — but they show in raw counts and become
-- confusing-to-debug ghost data.
--
-- This migration is idempotent: every DELETE is gated on `NOT EXISTS`
-- against `adopters`, so re-running is a no-op against a clean state.
--
-- The sweep is intentionally broader than the audit found, so any future
-- orphan growth across the same tables also gets caught on the next deploy.

DELETE FROM adoptions
WHERE adopter_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM adopters WHERE id = adoptions.adopter_id);

DELETE FROM adopter_stats
WHERE NOT EXISTS (SELECT 1 FROM adopters WHERE id = adopter_stats.adopter_id);

DELETE FROM adopter_history
WHERE NOT EXISTS (SELECT 1 FROM adopters WHERE id = adopter_history.adopter_id);

DELETE FROM duplicate_tokens
WHERE NOT EXISTS (SELECT 1 FROM adopters WHERE id = duplicate_tokens.adopter_id);

DELETE FROM pii_access_requests
WHERE NOT EXISTS (SELECT 1 FROM adopters WHERE id = pii_access_requests.adopter_id);

DELETE FROM pii_access_grants
WHERE NOT EXISTS (SELECT 1 FROM adopters WHERE id = pii_access_grants.adopter_id);

DELETE FROM duplicate_candidates
WHERE NOT EXISTS (SELECT 1 FROM adopters WHERE id = duplicate_candidates.adopter1_id)
   OR NOT EXISTS (SELECT 1 FROM adopters WHERE id = duplicate_candidates.adopter2_id);
