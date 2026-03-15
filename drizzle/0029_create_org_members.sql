-- Organization members (many-to-many: users ↔ organizations)
CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    user_email TEXT NOT NULL,
    role TEXT DEFAULT 'member',
    joined_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Prevent duplicate memberships
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_member_unique ON org_members (org_id, user_email);

-- Fast lookup: which orgs does a user belong to?
CREATE INDEX IF NOT EXISTS idx_org_member_email ON org_members (user_email);
