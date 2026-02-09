-- Data Requests: Track ARCO rights requests (access, rectification, deletion)
-- and inaccuracy reports from data subjects or community members
CREATE TABLE IF NOT EXISTS data_requests (
    id TEXT PRIMARY KEY,
    adopter_id TEXT,
    requester_name TEXT NOT NULL,
    requester_email TEXT,
    request_type TEXT NOT NULL DEFAULT 'inaccuracy',
    details TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    resolved_at INTEGER,
    resolved_by TEXT
);
