-- user_profiles.country and country_confirmed are already created by 0006_lame_lady_ursula.sql
-- Only add country to adopters (the one column not covered by 0006)
ALTER TABLE adopters ADD COLUMN country TEXT;

-- Backfill existing adopters as Argentina (all current data is from AR users)
UPDATE adopters SET country = 'AR' WHERE country IS NULL;
