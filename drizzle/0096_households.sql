-- Households as profiles (spec 2026-10-26-households-as-profiles-design).
-- Every person in a household is an adopter profile, and a household is a
-- group of profiles. These tables become the only record of who lives with
-- whom, replacing adopters.household_members (JSON) and household_links.
-- A profile may be in several households (separated parents).
CREATE TABLE IF NOT EXISTS households (
    id TEXT PRIMARY KEY,
    created_by TEXT,
    created_at INTEGER
);

-- relationship is relative to relative_to_adopter_id (the person they were
-- added next to: «pareja de Pedro»), unknown allowed. gift_recipient = 1 marks
-- a gift household (never shown under «Convive con»). source_key names where
-- the membership came from, for idempotent re-runs and resends:
-- inline:{hostId}:{memberId}, link:{linkId}, form-{submissionId}-{i},
-- interview:{id}:{i}, import:{batch}:{row}. Memberships carry no age: it lives
-- on the profile (adopters.age, age_as_of, is_minor).
CREATE TABLE IF NOT EXISTS household_memberships (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    adopter_id TEXT NOT NULL,
    relationship TEXT NOT NULL DEFAULT 'unknown',
    relative_to_adopter_id TEXT,
    gift_recipient INTEGER NOT NULL DEFAULT 0,
    added_by TEXT,
    added_at INTEGER NOT NULL,
    source_key TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_household_memberships_pair ON household_memberships (household_id, adopter_id);
CREATE INDEX IF NOT EXISTS idx_household_memberships_adopter ON household_memberships (adopter_id);
CREATE INDEX IF NOT EXISTS idx_household_memberships_household ON household_memberships (household_id);
CREATE INDEX IF NOT EXISTS idx_household_memberships_source_key ON household_memberships (source_key);

-- «No vive acá» (D48): someone said this person does not live in this
-- household. Re-adding them to it, or a merge bringing them back, is a
-- dispute the admins hear about. snapshot: the removed membership row as
-- JSON, for an admin to put back.
CREATE TABLE IF NOT EXISTS household_corrections (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    adopter_id TEXT NOT NULL,
    corrected_by TEXT NOT NULL,
    corrected_at INTEGER NOT NULL,
    snapshot TEXT
);
CREATE INDEX IF NOT EXISTS idx_household_corrections_pair ON household_corrections (household_id, adopter_id);
CREATE INDEX IF NOT EXISTS idx_household_corrections_adopter ON household_corrections (adopter_id);

-- Age lives on the profile: the age as given on age_as_of (YYYY-MM-DD) goes
-- up by itself (currentAge). is_minor: the «Es menor de edad» checkbox.
ALTER TABLE adopters ADD COLUMN age INTEGER;
ALTER TABLE adopters ADD COLUMN age_as_of TEXT;
ALTER TABLE adopters ADD COLUMN is_minor INTEGER NOT NULL DEFAULT 0;
