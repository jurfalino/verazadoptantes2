-- Interview guide (spec .agents/plans/interview-guide.md section 5.1).
-- One row per phone interview. Drafts autosave here; on completion adopter_id
-- and event_id (the observation row) are set and status flips last.
CREATE TABLE IF NOT EXISTS interviews (
    id TEXT PRIMARY KEY,
    conducted_by TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    source_kind TEXT NOT NULL,
    source_id TEXT,
    prep_json TEXT,
    answers_json TEXT,
    candidate_ids_json TEXT,
    adopter_id TEXT,
    event_id TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now')),
    completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_interviews_drafts ON interviews (conducted_by, status);
CREATE INDEX IF NOT EXISTS idx_interviews_adopter ON interviews (adopter_id);
CREATE INDEX IF NOT EXISTS idx_interviews_event ON interviews (event_id);
