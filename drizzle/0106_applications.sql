-- 2026-11-10: «Evaluar solicitudes» — one row per (form, animal) application, so a
-- form answered for an animal can be evaluated, declined, proposed elsewhere or
-- closed on its own. The adopter is form_submissions.linked_adopter_id through
-- submission_id (no adopter_id here). Additive only: a new table plus a backfill
-- of one application per existing form. Production has 0 forms, so the backfill
-- only matters for staging and the e2e DB. Idempotent: every statement can re-run.
CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY NOT NULL,
  submission_id TEXT NOT NULL,
  animal_id TEXT,
  origin TEXT NOT NULL DEFAULT 'form',
  asked_animal_id TEXT,
  state TEXT NOT NULL DEFAULT 'open',
  close_reason TEXT,
  decline_record_id TEXT,
  proposed_application_id TEXT,
  replaced_by_application_id TEXT,
  offer_done_at INTEGER,
  closed_at INTEGER,
  closed_by TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_applications_animal_state ON applications (animal_id, state);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_applications_submission ON applications (submission_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_one_per_form ON applications (submission_id) WHERE origin <> 'proposed';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_one_proposal ON applications (submission_id, animal_id) WHERE origin = 'proposed';
--> statement-breakpoint
-- Backfill: a form for an animal nobody adopted stays open; adopted by its own
-- applicant = adopted; adopted by someone else = closed. offer_done_at is set on
-- every closed or adopted row so the home never shows a stale «avisá a N».
INSERT OR IGNORE INTO applications (id, submission_id, animal_id, origin, state, close_reason, offer_done_at, closed_at, closed_by, created_at)
SELECT 'app-' || fs.id, fs.id, fs.selected_animal_id, 'form',
  CASE WHEN p.id IS NULL THEN 'open' WHEN p.adopter_id = fs.linked_adopter_id THEN 'adopted' ELSE 'closed' END,
  CASE WHEN p.id IS NOT NULL AND p.adopter_id IS NOT fs.linked_adopter_id THEN 'adopted_other' END,
  CASE WHEN p.id IS NOT NULL THEN CAST(strftime('%s','now') AS INTEGER) END,
  p.started_at,
  CASE WHEN p.id IS NOT NULL THEN 'application-auto' END,
  fs.created_at
FROM form_submissions fs
LEFT JOIN placements p ON p.animal_id = fs.selected_animal_id AND p.ended_at IS NULL AND p.record_type = 'adoption';
