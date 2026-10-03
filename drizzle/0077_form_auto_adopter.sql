-- v2.56.129: remember which profile a form submission auto-created.
--
-- Every submission auto-creates a profile and links the form to it, so
-- `linked_adopter_id` is set before the rescuer decides anything. The
-- form-results page read it as "linked" and looked identical before and after
-- the rescuer chose an existing profile. Comparing it with this column tells
-- the two apart (src/domain/formLink.ts). Written once at submit, never
-- re-pointed — a merge moves `linked_adopter_id`, not this.
ALTER TABLE form_submissions ADD COLUMN auto_adopter_id TEXT;

-- Backfill. Only for forms that provably went through auto-create (their
-- `auto_created_from_form` history row exists — merges move history rows
-- between profiles, so it proves the form, not which profile). The profile is
-- then the form-sourced one the same rescuer got, with the same name, within
-- two minutes of the submission, preferring the one the form still points at.
-- Ambiguous older rows stay NULL, which reads as "linked to an existing
-- profile" when linked — exactly what the page showed for them before.
-- Production holds no form submissions at the time of writing, so this is for
-- staging's test rows.
-- Written as COALESCE of two lookups because SQLite rejects a reference to
-- the outer row inside a subquery's ORDER BY ("no such column") — the first
-- draft did that and failed the migration outright.
UPDATE form_submissions
SET auto_adopter_id = COALESCE(
    -- The form still points at its auto-created profile (the common case).
    (SELECT a.id FROM adopters a
     WHERE a.id = form_submissions.linked_adopter_id
       AND a.source = 'form'
       AND a.added_by = form_submissions.user_id
       AND a.name = trim(form_submissions.name)
       AND abs(a.created_at - form_submissions.created_at) <= 120),
    -- It was re-pointed to an existing profile: find the one it created.
    (SELECT a.id FROM adopters a
     WHERE a.source = 'form'
       AND a.added_by = form_submissions.user_id
       AND a.name = trim(form_submissions.name)
       AND abs(a.created_at - form_submissions.created_at) <= 120
     LIMIT 1)
)
WHERE auto_adopter_id IS NULL
  AND EXISTS (
    SELECT 1 FROM adopter_history h
    WHERE h.changed_by = 'form-submission'
      -- json_extract raises on malformed JSON, and SQLite does not promise to
      -- evaluate AND operands in order: one bad row anywhere would fail the
      -- migration and block the deploy. CASE does guarantee order.
      AND CASE WHEN json_valid(h.changes)
               THEN json_extract(h.changes, '$.auto_created_from_form.submissionId')
          END = form_submissions.id
  );
