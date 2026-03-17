-- Add country column to user_profiles and adopters
ALTER TABLE user_profiles ADD COLUMN country TEXT;
ALTER TABLE user_profiles ADD COLUMN country_confirmed INTEGER DEFAULT 0;
ALTER TABLE adopters ADD COLUMN country TEXT;

-- Backfill existing adopters as Argentina (all current data is from AR users)
UPDATE adopters SET country = 'AR' WHERE country IS NULL;
