-- Spreadsheet-import audit: a run header (written when the import starts) + its
-- per-row items (written at the end). Powers the admin view at /admin/imports.
CREATE TABLE IF NOT EXISTS import_runs (
	id text PRIMARY KEY NOT NULL,
	actor_email text,
	source text,
	total integer DEFAULT 0,
	created_count integer DEFAULT 0,
	updated_count integer DEFAULT 0,
	skipped_count integer DEFAULT 0,
	failed_count integer DEFAULT 0,
	status text NOT NULL DEFAULT 'running',
	started_at integer DEFAULT (strftime('%s', 'now')),
	finished_at integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_import_runs_actor ON import_runs (actor_email);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_import_runs_started ON import_runs (started_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS import_run_items (
	id text PRIMARY KEY NOT NULL,
	run_id text NOT NULL,
	row_index integer,
	adopter_id text,
	adopter_name text,
	action text,
	status text,
	matched_adopter_id text,
	matched_adopter_name text,
	match_confidence integer,
	message text,
	created_at integer DEFAULT (strftime('%s', 'now'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_import_run_items_run ON import_run_items (run_id);
