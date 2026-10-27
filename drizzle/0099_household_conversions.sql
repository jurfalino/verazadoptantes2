-- Households as profiles (Task 7): the conversion ledger. One row per piece of
-- today's data the conversion handled — an inline household member
-- (inline:{hostId}:{memberId}), a household_links row (link:{linkId}) or a
-- «No convive» correction (correction:{id}) — written in the same batch as the
-- membership it produced and NEVER deleted. «Converted» means a row here, not a
-- membership: after «Quitar del hogar», «No vive acá», «Eliminar perfil» or a
-- merge collapse the membership is gone on purpose, and the old JSON (kept
-- until a later release) must not bring the person back on the next view.
-- outcome: 'converted' | 'skipped' (a permanent skip: no name and no contact,
-- a self link, a gift recipient — retried only when the member's content
-- changes, i.e. its fingerprint). fingerprint: hash of the member's content
-- without ids (an old merge copied members under new ids; undo matches them
-- back by it). owner_email: the owner a created profile got (undo of an old
-- merge re-owns it compare-and-set on this value). No PII here.
CREATE TABLE IF NOT EXISTS household_conversions (
    source_key TEXT PRIMARY KEY,
    host_adopter_id TEXT NOT NULL,
    member_id TEXT,
    link_id TEXT,
    outcome TEXT NOT NULL,
    reason TEXT,
    fingerprint TEXT,
    household_id TEXT,
    membership_id TEXT,
    profile_id TEXT,
    created_profile INTEGER NOT NULL DEFAULT 0,
    owner_email TEXT,
    actor TEXT,
    converted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_household_conversions_host ON household_conversions (host_adopter_id);
CREATE INDEX IF NOT EXISTS idx_household_conversions_profile ON household_conversions (profile_id);
