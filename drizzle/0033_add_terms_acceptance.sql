-- Migration: Add Terms & Conditions acceptance tracking
-- Adds two columns for legal audit trail and resets country_confirmed
-- so ALL existing users are re-prompted to accept the T&C on next sign-in.
--
-- NOTE: All statements use IF NOT EXISTS so this migration is safe to
-- re-run on databases where the columns were previously added manually.
-- The UPDATE is always re-applied to ensure no user bypasses the T&C gate.

-- T&C acceptance audit columns
ALTER TABLE `user_profiles` ADD COLUMN IF NOT EXISTS `terms_accepted_at` INTEGER;
ALTER TABLE `user_profiles` ADD COLUMN IF NOT EXISTS `terms_version` INTEGER;

-- Force re-prompt for all existing users.
-- Resetting country_confirmed to 0 causes the CountryConfirmBanner to
-- re-fire. The banner's updated visibility logic also checks termsVersion,
-- so users cannot bypass the T&C step via the localStorage cache.
UPDATE user_profiles SET country_confirmed = 0;
