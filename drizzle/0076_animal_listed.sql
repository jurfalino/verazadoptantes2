-- v2.56.128: two changes to who appears in the public catalogue.
--
-- 1. An animal in a FOSTER home belongs in it. It is the clearest case of an
--    animal still looking for a permanent home — someone is caring for it,
--    there are photos of it settled in, and a person who can tell an adopter
--    what it is actually like. Today recording a tránsito removes it from the
--    catalogue, which is backwards. The gate moves to the showcase query; the
--    view just has to carry the new flag.
--
-- 2. The rescuer decides. An animal under treatment, or one already promised,
--    should be able to sit out of the catalogue without being adopted or
--    having its photos deleted. `animals.listed` is that switch.
--
-- NULL means listed. Every existing animal keeps appearing exactly as it does
-- now, and the column only ever holds 0 when a rescuer explicitly turns it
-- off — so a deploy changes nothing by itself.
ALTER TABLE animals ADD COLUMN listed INTEGER;

-- The compat view has to project it, because the showcase reads `adoptions`.
-- A view holds no data: dropping and recreating it is free, and 0056 did the
-- same. Column order and names are otherwise untouched — every other read
-- site keeps working unchanged.
DROP VIEW IF EXISTS adoptions;
CREATE VIEW adoptions AS
SELECT an.id, p.adopter_id, an.name AS animal_name, an.species, an.details, p.status, p.rating, p.comments,
  COALESCE(p.started_at, an.created_at) AS date, an.added_by, p.on_behalf_of, COALESCE(p.record_type,'available') AS record_type,
  p.delivered_to_home, p.verified_address, p.identity_verified, COALESCE(p.source_url, an.source_url) AS source_url,
  an.age, an.estimated_birth_date, an.neutered, an.sex, an.color, an.microchip, an.listed
FROM animals an
LEFT JOIN placements p ON p.animal_id = an.id AND p.ended_at IS NULL
WHERE an.deleted_at IS NULL
UNION ALL
-- An adopter event is not an animal and can never be in the catalogue; it has
-- no `listed` of its own.
SELECT e.id, e.adopter_id, e.animal_name, e.species, e.details, e.status, e.rating, NULL,
  e.date, e.recorded_by, e.on_behalf_of, e.event_type,
  NULL, NULL, NULL, e.source_url, NULL, NULL, NULL, NULL, NULL, NULL, NULL
FROM adopter_events e;
