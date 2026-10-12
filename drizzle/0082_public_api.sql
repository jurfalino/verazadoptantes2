-- Third-party API v1 (.agents/plans/2026-10-09-third-party-api.md).
--
-- api_keys: one row per key a rescue's own tools use. Only the SHA-256 of the
-- secret is stored; the secret is shown once when the key is issued.
-- api_requests: every API call, for admin review, the rescuer's own log,
-- idempotent replay and daily caps. request_body holds the person data the
-- client sent, so it is purged after 90 days (src/lib/api/handler.ts).
CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL,
    org_id TEXT,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    environment TEXT NOT NULL DEFAULT 'live',
    scopes TEXT NOT NULL,
    daily_cap_exact INTEGER NOT NULL DEFAULT 500,
    daily_cap_fuzzy INTEGER NOT NULL DEFAULT 50,
    created_by TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    last_used_at INTEGER,
    revoked_at INTEGER,
    revoked_by TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys (key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_owner ON api_keys (owner_email);

CREATE TABLE IF NOT EXISTS api_requests (
    id TEXT PRIMARY KEY,
    key_id TEXT NOT NULL,
    owner_email TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    mode TEXT,
    context TEXT,
    outcome TEXT,
    http_status INTEGER NOT NULL,
    error_id TEXT,
    request_body TEXT,
    response_body TEXT,
    profile_ids TEXT,
    record_id TEXT,
    profile_created INTEGER NOT NULL DEFAULT 0,
    idempotency_key TEXT,
    external_id TEXT,
    voided_at INTEGER,
    voided_by TEXT,
    duration_ms INTEGER,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_api_requests_key_time ON api_requests (key_id, created_at);
CREATE INDEX IF NOT EXISTS idx_api_requests_owner_time ON api_requests (owner_email, created_at);
CREATE INDEX IF NOT EXISTS idx_api_requests_time ON api_requests (created_at);
CREATE INDEX IF NOT EXISTS idx_api_requests_record ON api_requests (record_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_requests_idempotency ON api_requests (key_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_api_requests_external ON api_requests (key_id, external_id);
