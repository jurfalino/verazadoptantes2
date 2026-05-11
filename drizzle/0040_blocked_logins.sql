-- Migration: blocked_logins + error_reports tables (v2.14.9-14)
-- blocked_logins: adopter-login gate writes one row per rejected sign-in.
-- error_reports: free-text submissions from /auth-error "report this problem"
-- form (used by blocked adopters who think the app is broken).
-- Schemas mirror src/db/schema.ts.

CREATE TABLE IF NOT EXISTS blocked_logins (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    attempted_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    matched_adopter_ids TEXT NOT NULL,
    reason TEXT NOT NULL,
    matched_summary TEXT
);

CREATE INDEX IF NOT EXISTS idx_blocked_attempted ON blocked_logins (attempted_at);
CREATE INDEX IF NOT EXISTS idx_blocked_email ON blocked_logins (email);

CREATE TABLE IF NOT EXISTS error_reports (
    id TEXT PRIMARY KEY,
    email TEXT,
    message TEXT,
    user_agent TEXT,
    ip_hash TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_error_reports_created ON error_reports (created_at);
