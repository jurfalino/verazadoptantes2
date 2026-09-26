-- How well the search matched the one adopter it found. Without it the deck
-- cannot tell "this is certainly them" from "one row happened to match", and
-- v2.56.82 showed a person the rescuer never confirmed.
ALTER TABLE pending_searches ADD COLUMN match_confidence INTEGER;
