-- Organization invite tokens (shareable links)
CREATE TABLE IF NOT EXISTS org_invites (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    expires_at INTEGER,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Fast lookup by org
CREATE INDEX IF NOT EXISTS idx_org_invite_org ON org_invites (org_id);
