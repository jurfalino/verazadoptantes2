-- Add province_code column to user_profiles (auto-detected via cf-region-code)
ALTER TABLE user_profiles ADD COLUMN province_code TEXT;
