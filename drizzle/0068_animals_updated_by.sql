-- v2.56.16: who last edited the animal's ficha.
--
-- The card's new «Actualizado por …» derives its actor from the activity tables
-- (placements / adopter_events / animal_events all carry `recorded_by`), which
-- cannot go stale because nothing has to remember to stamp them. The one thing
-- those tables cannot see is a pure identity edit — renaming the animal, fixing
-- its color, adding a microchip — which touches only `animals`. This column
-- closes that gap; NULL on legacy rows falls back to `added_by`.
ALTER TABLE animals ADD COLUMN updated_by TEXT;
