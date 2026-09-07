-- v2.55.15 (animal-timeline PR2): animal-scoped care log.
-- Vaccinations, dewormings, vet visits, neuter and free notes are events about
-- the ANIMAL (they happen in rescue, transit and adoption alike), so they get
-- their own table instead of relaxing adopter_events.adopter_id.
-- followup_key is created now to avoid a second ALTER when PR3 wires the
-- projected-slot matching.

CREATE TABLE IF NOT EXISTS animal_events (
  id TEXT PRIMARY KEY,
  animal_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  date INTEGER,
  details TEXT,
  followup_key TEXT,
  placement_id TEXT,
  recorded_by TEXT DEFAULT 'anonymous',
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_animal_events_animal ON animal_events(animal_id, date);
