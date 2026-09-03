-- Structured household/family members: a JSON array of people, each with a name,
-- relationship, and their own contact entries (src/lib/householdMembers.ts).
-- Replaces the free-text family_members field (retained read-only for migration).
ALTER TABLE adopters ADD COLUMN household_members text;
