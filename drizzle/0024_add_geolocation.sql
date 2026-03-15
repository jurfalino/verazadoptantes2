-- Add province column to user_profiles (auto-detected via cf-region)
-- Each geo column is in its own file so Playwright CI's per-file error
-- handler allows subsequent columns to be added even if this one exists.
ALTER TABLE user_profiles ADD COLUMN province TEXT;
