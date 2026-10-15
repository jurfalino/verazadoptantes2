-- 2026-10-01: applicants are listed per animal for the whole team
-- (src/lib/applicantScope.ts): `WHERE selected_animal_id = ? AND (lower(user_id) = ? OR …)`,
-- once per available animal on /my-animals and on every animal page. Without
-- this index each of those is a full scan of form_submissions. user_id is
-- wrapped in lower() for case-insensitive matching, so only selected_animal_id
-- can be indexed — it is also by far the more selective column.
CREATE INDEX IF NOT EXISTS idx_form_selected_animal ON form_submissions(selected_animal_id);
