-- Add city column to user_profiles (auto-detected via cf-ipcity)
ALTER TABLE user_profiles ADD COLUMN city TEXT;
