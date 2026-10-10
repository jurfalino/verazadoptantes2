-- One ACTIVE placement per animal, enforced by the database.
--
-- A placement with ended_at IS NULL is who holds the animal right now. Two
-- people assigning the same available animal at the same moment could each
-- open one (record-edit collisions review): the app reads "no active
-- placement", then both insert. The unique partial index below makes the
-- second insert fail, and the app maps that failure to «<Animal> ya tiene una
-- adopción o tránsito activo.» (or re-reads and re-plans, for an edit).
--
-- Step 1 closes any duplicates that already exist, so the index can be built.
-- Production had none on 2026-10-04 (103 active placements, 0 animals with
-- more than one); staging had 5 animals with duplicates (test data). Per
-- animal the newest stays active: highest started_at, then created_at, then
-- id (NULLs lowest). Every other active one is ended at the kept placement's
-- start (or now when that is unknown) — the moment custody moved. Placements
-- have no end-reason column, so nothing else is written. Idempotent: once at
-- most one placement per animal is active, no row matches.
UPDATE placements
SET ended_at = COALESCE(
    (SELECT k.started_at FROM placements k
     WHERE k.animal_id = placements.animal_id AND k.ended_at IS NULL
     ORDER BY COALESCE(k.started_at, -1) DESC, COALESCE(k.created_at, -1) DESC, k.id DESC
     LIMIT 1),
    strftime('%s', 'now')
)
WHERE ended_at IS NULL
  AND EXISTS (
    SELECT 1 FROM placements k
    WHERE k.animal_id = placements.animal_id
      AND k.ended_at IS NULL
      AND k.id <> placements.id
      AND (COALESCE(k.started_at, -1), COALESCE(k.created_at, -1), k.id)
        > (COALESCE(placements.started_at, -1), COALESCE(placements.created_at, -1), placements.id)
  );

-- Step 2: the guarantee.
CREATE UNIQUE INDEX IF NOT EXISTS idx_placements_one_active ON placements(animal_id) WHERE ended_at IS NULL;
