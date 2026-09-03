-- Content-bind the "Contacto en notas" false-positive dismissal: store a hash of
-- the reviewed note so the report re-surfaces it if the note is later edited
-- through ANY write path (not just the data-quality inline edit).
ALTER TABLE adopter_events ADD COLUMN pii_dismissed_hash text;
