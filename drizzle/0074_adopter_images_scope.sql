-- v2.56.124: say what a photo is a photo OF.
--
-- `adopter_images.adoption_id` is overloaded. For an animal's own gallery it
-- holds the ANIMAL id; for a care event or follow-up it holds the EVENT id —
-- and the adopter-side record editor ALSO writes the animal id when the record
-- is a placement. So the animal key mixes two kinds of photo that belong in
-- different places:
--
--   * taken OF THE ANIMAL (the create form, "Editar" on the animal page) —
--     these are the animal's, they survive a return, and they belong on the
--     public page;
--   * taken while recording an ADOPTION or TRÁNSITO from the adopter's side —
--     the handover, a document, the family. Never public.
--
-- No existing column separates them: both carry the holder's adopter_id once
-- the animal is placed. This column says it explicitly, at write time.
--
-- Event-keyed photos (seguimientos, care events) need no scope: the public
-- reads look up the ANIMAL id, which those rows do not carry, so they are
-- already out — and they stay out.
ALTER TABLE adopter_images ADD COLUMN scope TEXT;

-- Backfill only what is unambiguous. '__available__' is the sentinel the
-- create form writes, and the animal-page editor writes it too whenever the
-- animal has no current holder — no adopter-side flow ever writes it, so every
-- such row is the animal's own photo.
UPDATE adopter_images
   SET scope = 'animal'
 WHERE adopter_id = '__available__'
   AND adoption_id IS NOT NULL;

-- The second unambiguous case, from the other direction: an animal-keyed photo
-- with NO caption. Every flow that writes one from the adopter's side stamps a
-- caption automatically ("Photo for X", "Video for X"), as does the create
-- form; the ONLY path that leaves it empty is addAnimalPhoto — «Editar» on the
-- animal's own page. In production this is exactly the 3 rows that the
-- adopter_id rule could not reach, all on one animal, confirmed by Jon on
-- 2026-10-03 as photos of the animal.
UPDATE adopter_images
   SET scope = 'animal'
 WHERE scope IS NULL
   AND (caption IS NULL OR caption = '')
   AND adoption_id IN (SELECT id FROM animals);

-- Anything still NULL stays NOT public: a photo of the family shown to
-- strangers is a far worse outcome than a photo of the animal that a rescuer
-- has to re-add. In production, after both rules, that is zero rows.
CREATE INDEX IF NOT EXISTS idx_adopter_images_adoption_scope
    ON adopter_images(adoption_id, scope);
