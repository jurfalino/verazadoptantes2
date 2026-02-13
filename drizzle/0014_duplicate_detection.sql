-- Add duplicate detection columns to adopters
ALTER TABLE adopters ADD COLUMN token_hash TEXT;
ALTER TABLE adopters ADD COLUMN deleted_at INTEGER;

-- Token index for duplicate detection
CREATE TABLE IF NOT EXISTS duplicate_tokens (
    id TEXT PRIMARY KEY,
    adopter_id TEXT NOT NULL,
    token_type TEXT NOT NULL,
    token_value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dup_token ON duplicate_tokens (token_type, token_value);
CREATE INDEX IF NOT EXISTS idx_dup_adopter ON duplicate_tokens (adopter_id);

-- Pre-computed duplicate candidate pairs
CREATE TABLE IF NOT EXISTS duplicate_candidates (
    id TEXT PRIMARY KEY,
    adopter1_id TEXT NOT NULL,
    adopter2_id TEXT NOT NULL,
    match_types TEXT NOT NULL,
    match_values TEXT,
    score INTEGER NOT NULL,
    confidence TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    detected_at INTEGER DEFAULT (strftime('%s', 'now')),
    resolved_at INTEGER,
    resolved_by TEXT
);
