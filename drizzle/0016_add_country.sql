-- Add country column to user_profiles and adopters
-- Each ALTER is separated by statement-breakpoint so one failure doesn't block the others
ALTER TABLE user_profiles ADD COLUMN country TEXT;
--> statement-breakpoint
ALTER TABLE user_profiles ADD COLUMN country_confirmed INTEGER DEFAULT 0;
--> statement-breakpoint
ALTER TABLE adopters ADD COLUMN country TEXT;
--> statement-breakpoint
-- Backfill existing adopters as Argentina (all current data is from AR users)
UPDATE adopters SET country = 'AR' WHERE country IS NULL;
