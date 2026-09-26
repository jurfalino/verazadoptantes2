-- Searches that never turned into a record, so the homepage can ask about them
-- on the rescuer's next visit (ENABLE_PENDING_SEARCHES).
CREATE TABLE IF NOT EXISTS pending_searches (
    id TEXT PRIMARY KEY,
    user_email TEXT NOT NULL,
    query TEXT NOT NULL,
    adopter_id TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    resolved_at INTEGER,
    resolution TEXT
);

-- The read path is always "open asks for this rescuer".
CREATE INDEX IF NOT EXISTS idx_pending_searches_open ON pending_searches (user_email, resolved_at);

-- Closing every ask about an adopter when a record lands on them.
CREATE INDEX IF NOT EXISTS idx_pending_searches_adopter ON pending_searches (adopter_id);
