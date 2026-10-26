-- Disputes (spec 2026-10-25 pendientes D, addendum 2026-10-26, D49 and D50):
-- when rescuers disagree whether two profiles are the same person, the admins decide.

-- D49: after an owner rejected a request, the requester keeping the other
-- rescuer's profile no longer merges: it files a request to the admins
-- (owner_email NULL) marked as a dispute.
ALTER TABLE merge_requests ADD COLUMN dispute INTEGER NOT NULL DEFAULT 0;

-- D50: a merge that already happened (audit_log row of action adopter_merge)
-- disputed by the owner team of either profile. An admin keeps it or undoes
-- it (unmergeAdopters by audit id). status: open | kept | undone.
CREATE TABLE IF NOT EXISTS merge_disputes (
    id TEXT PRIMARY KEY,
    audit_id TEXT NOT NULL,
    survivor_id TEXT NOT NULL,
    absorbed_id TEXT NOT NULL,
    raised_by TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    status TEXT NOT NULL DEFAULT 'open',
    resolved_by TEXT,
    resolved_at INTEGER
);

-- One open dispute per merge (raising again is idempotent).
CREATE UNIQUE INDEX IF NOT EXISTS idx_merge_disputes_open_audit ON merge_disputes (audit_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_merge_disputes_audit ON merge_disputes (audit_id);
CREATE INDEX IF NOT EXISTS idx_merge_disputes_status_created ON merge_disputes (status, created_at);

-- D48 «No convive»: the linked profile's owner team (or an admin) said the
-- person does not live with the host. The member and its household_links row
-- are removed; this row remembers the correction, so re-adding the same
-- person to the same host is a dispute the admins hear about.
-- (household_links.hidden_at / hidden_by from the withdrawn D47 are no longer
-- read or written; a row hidden then reads as live.)
CREATE TABLE IF NOT EXISTS household_link_corrections (
    id TEXT PRIMARY KEY,
    host_adopter_id TEXT NOT NULL,
    linked_adopter_id TEXT NOT NULL,
    member_id TEXT,
    corrected_by TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_household_link_corrections_pair ON household_link_corrections (host_adopter_id, linked_adopter_id);
