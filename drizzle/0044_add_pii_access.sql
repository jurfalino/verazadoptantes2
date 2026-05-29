-- Migration: PII access gating tables (phase 2, behind ENABLE_PII_ACCESS_GATING).
--
-- pii_access_requests: a non-owner viewer's request to see an adopter's
--   contact details; resolved (approved/denied) by an owner/editor/admin.
-- pii_access_grants: the access facts — one row per (grantee, adopter) access.
--   scope='entry'       = unlocked by a search match.
--   scope='all_contact' = unlocked by an approved request.
--
-- Both tables are additive and unused until the feature flag is enabled.
-- Schemas mirror src/db/schema.ts.

CREATE TABLE IF NOT EXISTS pii_access_requests (
    id TEXT PRIMARY KEY,
    adopter_id TEXT NOT NULL,
    requester_email TEXT NOT NULL,
    justification TEXT,
    activity_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    resolved_by_email TEXT,
    resolved_at INTEGER,
    resolution_note TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_pii_req_adopter_status ON pii_access_requests (adopter_id, status);
CREATE INDEX IF NOT EXISTS idx_pii_req_requester_status ON pii_access_requests (requester_email, status);

CREATE TABLE IF NOT EXISTS pii_access_grants (
    id TEXT PRIMARY KEY,
    adopter_id TEXT NOT NULL,
    grantee_email TEXT NOT NULL,
    scope TEXT NOT NULL,
    entry_ref TEXT,
    origin TEXT NOT NULL,
    request_id TEXT,
    granted_by_email TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    revoked_at INTEGER,
    revoked_by_email TEXT
);

CREATE INDEX IF NOT EXISTS idx_pii_grant_grantee_adopter ON pii_access_grants (grantee_email, adopter_id);
