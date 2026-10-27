-- Households as profiles (Task 4 fix round 1): a membership's source_key (where
-- it came from: form-{submissionId}-{i}, interview:{id}-{i}, import:{adopterId}-{i},
-- import-post:{hash}-{slot}, gift-{submissionId}, inline:/link: from the
-- conversion) is UNIQUE, so two runs of the same source at once can never
-- place the same person twice: the loser's insert is ignored, it re-reads the
-- membership by its key and reuses that person. NULL keys (people added by
-- hand) never collide. Replaces the plain index of 0096.
DROP INDEX IF EXISTS idx_household_memberships_source_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_household_memberships_source_key ON household_memberships (source_key) WHERE source_key IS NOT NULL;
