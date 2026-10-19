-- API access by admin approval (Jon, 2026-10-17): a person asks at /developers
-- (after accepting the terms), an admin approves / denies / blocks in Admin → API.
-- Its own table, not a user role: a rescuer keeps viewer/contributor/admin.
CREATE TABLE IF NOT EXISTS api_access (
    user_email TEXT PRIMARY KEY,
    status TEXT NOT NULL,              -- requested | approved | denied | blocked
    tool TEXT,                         -- what they will connect (their words)
    purpose TEXT,                      -- what for (their words)
    requested_at INTEGER,
    decided_at INTEGER,
    decided_by TEXT,
    note TEXT                          -- the admin's note (shown to the person on a denial)
);
-- The error code of a refused call (422 / 409 / 429 / 503…), so it can be filtered
-- and survives the 90-day purge of the response body.
ALTER TABLE api_requests ADD COLUMN error_code TEXT;
