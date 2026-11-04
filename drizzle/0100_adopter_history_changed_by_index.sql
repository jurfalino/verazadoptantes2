-- Households as profiles, final fix S5: the per-person rename rate limit counts
-- a person's recent renames (adopter_history rows by changed_by since a time).
-- Without an index that count would scan the whole history on every rename.
CREATE INDEX IF NOT EXISTS idx_adopter_history_changed_by ON adopter_history (changed_by, changed_at);
