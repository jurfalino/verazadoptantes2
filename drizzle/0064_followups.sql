-- v2.55.16 (animal-timeline PR3): projected follow-ups.
-- followup_key links a recorded event to the projected slot it satisfies
-- (exact-match pass of the matching); followup_subtype classifies follow-ups
-- (adaptation | vaccination | neuter | vet_visit — same set for adoption and
-- transit, NULL on legacy rows). followup_settings is the per-user schedule +
-- message-template override JSON (NULL = defaults).
-- SQLite allows ADD COLUMN on tables referenced by the `adoptions` view.

ALTER TABLE adopter_events ADD COLUMN followup_key TEXT;
ALTER TABLE adopter_events ADD COLUMN followup_subtype TEXT;
ALTER TABLE user_profiles ADD COLUMN followup_settings TEXT;
