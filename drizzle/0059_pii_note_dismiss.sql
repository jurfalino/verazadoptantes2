-- Data-quality "Contacto en notas": mark an activity note as a reviewed FALSE
-- POSITIVE so it drops off the report (e.g. "de la calle" tripping the address
-- heuristic). NULL = still surfaced. Cleared when the note is edited.
ALTER TABLE adopter_events ADD COLUMN pii_dismissed_at integer;
