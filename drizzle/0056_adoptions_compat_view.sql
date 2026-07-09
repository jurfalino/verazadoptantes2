-- Normalization Phase 3/4 (transitional). Replace the `adoptions` TABLE with a
-- read-only VIEW that reconstructs the old row shape from the normalized tables
-- (current placement per animal + adopter events). All existing READ sites keep
-- working unchanged against the view; all WRITE sites are cut over to write the
-- normalized tables directly (a view is not writable). Validated on local: the
-- view reproduces the pre-migration `adoptions` rows exactly (0-diff, by-name).
--
-- Data safety: 0055 already backfilled every adoptions row into the normalized
-- tables, so dropping the table loses nothing. On the CI test DB (migrations run
-- against an empty DB, then seed.sql runs) the drop is of an empty table and
-- seed.sql inserts into the normalized tables directly.
DROP TABLE IF EXISTS adoptions;
--> statement-breakpoint
CREATE VIEW adoptions AS
SELECT an.id, p.adopter_id, an.name AS animal_name, an.species, an.details, p.status, p.rating, p.comments,
  COALESCE(p.started_at, an.created_at) AS date, an.added_by, p.on_behalf_of, COALESCE(p.record_type,'available') AS record_type,
  p.delivered_to_home, p.verified_address, p.identity_verified, COALESCE(p.source_url, an.source_url) AS source_url,
  an.age, an.estimated_birth_date, an.neutered, an.sex, an.color, an.microchip
FROM animals an
LEFT JOIN placements p ON p.animal_id = an.id AND p.ended_at IS NULL
WHERE an.deleted_at IS NULL
UNION ALL
SELECT e.id, e.adopter_id, e.animal_name, e.species, e.details, e.status, e.rating, NULL,
  e.date, e.recorded_by, e.on_behalf_of, e.event_type,
  NULL, NULL, NULL, e.source_url, NULL, NULL, NULL, NULL, NULL, NULL
FROM adopter_events e;
