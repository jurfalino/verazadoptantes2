-- v2.55.14: events know their animal.
-- `adopter_events.animal_id` / `placement_id` exist since 0054 but the write path
-- always stored NULL (the old model only copied the animal NAME). The write path
-- now populates them; this backfills history, best-effort and unambiguous-only:
-- an event links to an animal ONLY when exactly one animal matches by
-- (a placement with the event's adopter) + case/trim-insensitive name equality.
-- Ambiguous or unmatched rows stay NULL — the animal timeline simply omits them.

UPDATE adopter_events SET animal_id = (
  SELECT p.animal_id FROM placements p JOIN animals a ON a.id = p.animal_id
  WHERE p.adopter_id = adopter_events.adopter_id
    AND lower(trim(a.name)) = lower(trim(adopter_events.animal_name))
  ORDER BY p.started_at DESC LIMIT 1
)
WHERE event_type IN ('follow_up', 'returned_pet')
  AND animal_id IS NULL
  AND animal_name IS NOT NULL AND trim(animal_name) <> ''
  AND (
    SELECT COUNT(DISTINCT p.animal_id) FROM placements p JOIN animals a ON a.id = p.animal_id
    WHERE p.adopter_id = adopter_events.adopter_id
      AND lower(trim(a.name)) = lower(trim(adopter_events.animal_name))
  ) = 1;

-- placement_id: the latest placement of the (animal, adopter) pair whose span
-- started on/before the event date; fallback: the latest overall for the pair.
-- (Two subqueries + COALESCE: SQLite can't resolve outer-table columns inside a
-- subquery's ORDER BY expression, only in its WHERE.)
UPDATE adopter_events SET placement_id = COALESCE(
  (SELECT p.id FROM placements p
   WHERE p.animal_id = adopter_events.animal_id
     AND p.adopter_id = adopter_events.adopter_id
     AND p.started_at <= COALESCE(adopter_events.date, adopter_events.created_at)
   ORDER BY p.started_at DESC LIMIT 1),
  (SELECT p.id FROM placements p
   WHERE p.animal_id = adopter_events.animal_id
     AND p.adopter_id = adopter_events.adopter_id
   ORDER BY p.started_at DESC LIMIT 1)
)
WHERE event_type IN ('follow_up', 'returned_pet')
  AND animal_id IS NOT NULL
  AND placement_id IS NULL;
