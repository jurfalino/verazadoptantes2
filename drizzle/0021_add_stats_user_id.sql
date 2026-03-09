-- Add userId column to adopter_stats for actor tracking
-- This enables filtering admin activity from stats aggregations
ALTER TABLE adopter_stats ADD COLUMN user_id TEXT;

-- Index for efficient admin filtering on read queries
CREATE INDEX IF NOT EXISTS idx_stats_user ON adopter_stats(user_id);
