-- Normalize user identifiers: strip 'User: ' prefix from all tables
-- and replace 'Anon: Guest' / 'Unknown' with 'anonymous'

UPDATE adopters SET added_by = REPLACE(added_by, 'User: ', '') WHERE added_by LIKE 'User: %';
UPDATE adopters SET added_by = 'anonymous' WHERE added_by IN ('Anon: Guest', 'Unknown');

UPDATE adopter_history SET changed_by = REPLACE(changed_by, 'User: ', '') WHERE changed_by LIKE 'User: %';
UPDATE adopter_history SET changed_by = 'anonymous' WHERE changed_by IN ('Anon: Guest', 'Unknown');

UPDATE adoptions SET added_by = REPLACE(added_by, 'User: ', '') WHERE added_by LIKE 'User: %';
UPDATE adoptions SET added_by = 'anonymous' WHERE added_by IN ('Anon: Guest', 'Unknown');

UPDATE adopter_images SET added_by = REPLACE(added_by, 'User: ', '') WHERE added_by LIKE 'User: %';
UPDATE adopter_images SET added_by = 'anonymous' WHERE added_by IN ('Anon: Guest', 'Unknown');

UPDATE adopter_flags SET flagged_by = REPLACE(flagged_by, 'User: ', '') WHERE flagged_by LIKE 'User: %';
UPDATE adopter_flags SET flagged_by = 'anonymous' WHERE flagged_by IN ('Anon: Guest', 'Unknown');
