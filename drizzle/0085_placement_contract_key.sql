-- Signed contracts: the private-storage key lives in its OWN column, written
-- only by the server (contract signing, the API upload, the admin move) — never
-- in `comments`, which any rescuer can write through saveAdoption. The file
-- route (/api/files/contract) reads only this column.
ALTER TABLE placements ADD COLUMN contract_key TEXT;
--> statement-breakpoint
ALTER TABLE placements ADD COLUMN contract_sha256 TEXT;
--> statement-breakpoint
-- The compat view projects only WHETHER there is a contract (never the key),
-- appended at the end so every other column keeps its place.
DROP VIEW IF EXISTS adoptions;
--> statement-breakpoint
CREATE VIEW adoptions AS
SELECT an.id, p.adopter_id, an.name AS animal_name, an.species, an.details, p.status, p.rating, p.comments,
  COALESCE(p.started_at, an.created_at) AS date, an.added_by, p.on_behalf_of, COALESCE(p.record_type,'available') AS record_type,
  p.delivered_to_home, p.verified_address, p.identity_verified, COALESCE(p.source_url, an.source_url) AS source_url,
  an.age, an.estimated_birth_date, an.neutered, an.sex, an.color, an.microchip, an.listed,
  CASE WHEN p.contract_key IS NOT NULL THEN 1 ELSE 0 END AS has_contract
FROM animals an
LEFT JOIN placements p ON p.animal_id = an.id AND p.ended_at IS NULL
WHERE an.deleted_at IS NULL
UNION ALL
SELECT e.id, e.adopter_id, e.animal_name, e.species, e.details, e.status, e.rating, NULL,
  e.date, e.recorded_by, e.on_behalf_of, e.event_type,
  NULL, NULL, NULL, e.source_url, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  0
FROM adopter_events e;
