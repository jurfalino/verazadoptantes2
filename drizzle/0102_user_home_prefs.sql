-- 2026-11-04 homepage modules: what the person chose to hide on their home,
-- kept per account so it follows them to every device. HomePrefs JSON
-- (src/domain/homePrefs.ts), NULL = defaults (nothing hidden).
ALTER TABLE user_profiles ADD COLUMN home_prefs TEXT;
