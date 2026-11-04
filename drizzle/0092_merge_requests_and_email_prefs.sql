-- Merge requests between rescuers + email notifications
-- (spec: 2026-10-25 merge requests). A rescuer asks the owner of the other
-- profile to merge two duplicate adopters; primary survives, secondary is absorbed.
CREATE TABLE IF NOT EXISTS merge_requests (
    id TEXT PRIMARY KEY,
    primary_id TEXT NOT NULL,          -- older side, survives
    secondary_id TEXT NOT NULL,        -- newer side, absorbed
    candidate_id TEXT,                 -- duplicate_candidates row that triggered it
    flag_id TEXT,
    requester_email TEXT NOT NULL,
    owner_email TEXT,                  -- NULL = no real owner -> admins decide
    status TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | declined | cancelled | admin_approved | admin_declined | closed
    resolved_by_email TEXT,
    resolved_at INTEGER,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_merge_req_status_created ON merge_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_merge_req_requester ON merge_requests(requester_email, status);
CREATE INDEX IF NOT EXISTS idx_merge_req_owner ON merge_requests(owner_email, status);
CREATE INDEX IF NOT EXISTS idx_merge_req_pair ON merge_requests(primary_id, secondary_id, status);

-- Per-user email preferences (JSON EmailPrefs); NULL = defaults.
ALTER TABLE user_profiles ADD COLUMN email_prefs TEXT;
-- When the notification was emailed; NULL = not (yet) emailed.
ALTER TABLE notifications ADD COLUMN emailed_at INTEGER;
