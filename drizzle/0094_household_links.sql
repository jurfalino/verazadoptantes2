-- Linked convivientes (spec 2026-10-25 pendientes D, addendum D44 to D47).
-- A household member with its own adopter profile (household_members[].profileId,
-- set by addHouseholdMember from «No, es alguien de su hogar») gets a row here,
-- so the linked profile can show «Convive con» without anyone editing its data.
-- The host's household_members JSON stays the source of truth: a row only shows
-- while that member still exists on the host and still points at the profile.
-- hidden_at / hidden_by: the linked profile's owner team took the row off their
-- profile («Quitar de mi perfil», D47). The host's member is never changed.
CREATE TABLE IF NOT EXISTS household_links (
    id TEXT PRIMARY KEY,
    host_adopter_id TEXT NOT NULL,
    linked_adopter_id TEXT NOT NULL,
    member_id TEXT NOT NULL,
    created_by TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    hidden_at INTEGER,
    hidden_by TEXT
);

-- One link per host member (makes the backfill and every later write idempotent).
CREATE UNIQUE INDEX IF NOT EXISTS idx_household_links_host_member ON household_links (host_adopter_id, member_id);
CREATE INDEX IF NOT EXISTS idx_household_links_host ON household_links (host_adopter_id);
CREATE INDEX IF NOT EXISTS idx_household_links_linked ON household_links (linked_adopter_id);

-- Backfill from existing household members that carry a profileId. SQLite does
-- not guarantee WHERE order, so every JSON probe is guarded where it is made:
-- the CASE in json_each keeps it away from malformed or non-array JSON, and the
-- CASE WHEN m.type = 'object' keeps the path probes away from text or number
-- elements (json_type on an unquoted text value raises malformed JSON).
-- Skips self-links, deleted hosts, missing profiles.
INSERT OR IGNORE INTO household_links (id, host_adopter_id, linked_adopter_id, member_id, created_by, created_at)
SELECT
    'hl-' || a.id || '-' || CASE WHEN m.type = 'object' THEN json_extract(m.value, '$.id') END,
    a.id,
    CASE WHEN m.type = 'object' THEN json_extract(m.value, '$.profileId') END,
    CASE WHEN m.type = 'object' THEN json_extract(m.value, '$.id') END,
    COALESCE(CASE WHEN m.type = 'object' THEN json_extract(m.value, '$.addedBy') END, a.added_by),
    strftime('%s', 'now')
FROM adopters a, json_each(CASE WHEN json_valid(a.household_members) AND json_type(a.household_members) = 'array' THEN a.household_members ELSE '[]' END) m
WHERE a.deleted_at IS NULL
    AND m.type = 'object'
    AND CASE WHEN m.type = 'object' THEN json_type(m.value, '$.profileId') END = 'text'
    AND CASE WHEN m.type = 'object' THEN json_type(m.value, '$.id') END = 'text'
    AND CASE WHEN m.type = 'object' THEN json_extract(m.value, '$.profileId') END <> a.id
    AND EXISTS (SELECT 1 FROM adopters l WHERE l.id = CASE WHEN m.type = 'object' THEN json_extract(m.value, '$.profileId') END);
