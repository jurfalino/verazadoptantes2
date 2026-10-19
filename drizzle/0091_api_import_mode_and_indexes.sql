-- v2.56.205 (2026-10-18), before the Catpuccino import through the API.
-- 1) Lookups by profile on three tables were full scans on every API call for a
--    known person (and every flag / photo / duplicate-pair read across the app).
CREATE INDEX IF NOT EXISTS idx_adopter_flags_adopter ON adopter_flags (adopter_id);
CREATE INDEX IF NOT EXISTS idx_adopter_images_adopter ON adopter_images (adopter_id);
CREATE INDEX IF NOT EXISTS idx_dup_candidates_pair ON duplicate_candidates (adopter1_id, adopter2_id);
CREATE INDEX IF NOT EXISTS idx_dup_candidates_second ON duplicate_candidates (adopter2_id);
-- 2) A key in import mode, until import_mode (unix seconds; 0 = off): no
--    notifications per saved record, no daily cap on exact calls, and the slow
--    name / contact LIKE scan of the duplicate check is skipped (the admin
--    duplicate scan runs once after the import instead). See importModeOn().
ALTER TABLE api_keys ADD COLUMN import_mode INTEGER NOT NULL DEFAULT 0;
