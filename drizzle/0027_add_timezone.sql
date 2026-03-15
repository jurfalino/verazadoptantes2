-- Add timezone column to user_profiles (auto-detected via cf-timezone)
ALTER TABLE user_profiles ADD COLUMN timezone TEXT;
