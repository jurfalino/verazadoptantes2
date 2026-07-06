-- Normalization Phase 1 (backfill). Populate animals / placements / adopter_events
-- from existing `adoptions` rows. `adoptions` is left intact (dropped later in the
-- contract phase). Ids are preserved: available/foster/adoption → animals.id;
-- the 4 event types → adopter_events.id; placements get fresh ids.
-- Idempotent-ish: guarded by NOT EXISTS so re-running won't duplicate.

-- 1. Animals ← identity from available/foster/adoption rows (id preserved).
INSERT INTO animals (id, name, species, details, age, estimated_birth_date, neutered, sex, color, microchip, source_url, added_by, created_at, updated_at, deleted_at)
SELECT a.id, a.animal_name, a.species, a.details, a.age, a.estimated_birth_date, a.neutered, a.sex, a.color, a.microchip, a.source_url, a.added_by,
       COALESCE(a.date, strftime('%s','now')), COALESCE(a.date, strftime('%s','now')), NULL
FROM adoptions a
WHERE a.record_type IN ('available','foster','adoption')
  AND NOT EXISTS (SELECT 1 FROM animals an WHERE an.id = a.id);
--> statement-breakpoint

-- 2. Placements ← custody spans from foster/adoption rows that have an adopter.
--    All backfilled placements are ACTIVE (ended_at NULL) — they are the current
--    live placement; there is no prior history to reconstruct (the old model
--    overwrote it). New id per row.
INSERT INTO placements (id, animal_id, adopter_id, record_type, started_at, ended_at, rating, status, delivered_to_home, verified_address, identity_verified, on_behalf_of, comments, source_url, recorded_by, created_at)
SELECT lower(hex(randomblob(16))), a.id, a.adopter_id, a.record_type, a.date, NULL, a.rating, a.status, a.delivered_to_home, a.verified_address, a.identity_verified, a.on_behalf_of, a.comments, a.source_url, a.added_by, COALESCE(a.date, strftime('%s','now'))
FROM adoptions a
WHERE a.record_type IN ('foster','adoption')
  AND a.adopter_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM placements p WHERE p.animal_id = a.id);
--> statement-breakpoint

-- 3. Adopter events ← the 4 event types (id preserved). animal_id/placement_id
--    stay NULL: the old model never linked events to an animal id (follow_up/
--    returned_pet only copied the animal NAME).
INSERT INTO adopter_events (id, adopter_id, event_type, animal_id, placement_id, animal_name, species, status, rating, details, date, on_behalf_of, source_url, recorded_by, created_at)
SELECT a.id, a.adopter_id, a.record_type, NULL, NULL, a.animal_name, a.species, a.status, a.rating, a.details, a.date, a.on_behalf_of, a.source_url, a.added_by, COALESCE(a.date, strftime('%s','now'))
FROM adoptions a
WHERE a.record_type IN ('observation','adoption_request','follow_up','returned_pet')
  AND a.adopter_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM adopter_events e WHERE e.id = a.id);
