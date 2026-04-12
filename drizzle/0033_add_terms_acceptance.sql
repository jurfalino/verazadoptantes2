-- Migration: Add Terms & Conditions acceptance tracking
-- Adds two columns for legal audit trail and resets country_confirmed
-- so ALL existing users are re-prompted to accept the T&C on next sign-in.
--
-- WARNING: This migration is NOT safe to re-run.
-- The ALTER TABLE statements will fail if columns already exist (SQLite
-- does not support IF NOT EXISTS on ALTER TABLE ADD COLUMN in older versions).
-- The UPDATE resets country_confirmed = 0 for ALL users, forcing every
-- existing user back through the onboarding gate. Do NOT re-apply manually
-- during DB repairs — use a new numbered migration instead.

-- T&C acceptance audit columns
ALTER TABLE user_profiles ADD COLUMN terms_accepted_at INTEGER;
ALTER TABLE user_profiles ADD COLUMN terms_version INTEGER;

-- Force re-prompt for all existing users.
-- Resetting country_confirmed to 0 causes the CountryConfirmBanner to
-- re-fire. The banner's updated visibility logic also checks termsVersion,
-- so users cannot bypass the T&C step via the localStorage cache.
UPDATE user_profiles SET country_confirmed = 0;
