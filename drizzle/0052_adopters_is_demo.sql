-- Walkthrough demo rows marker. 1 = a record used ONLY by the guided walkthrough
-- demo. Demo rows are also soft-deleted (deleted_at SET) so every existing
-- `deleted_at IS NULL` query excludes them automatically; the walkthrough and the
-- /admin/walkthrough panel fetch them by this marker. Default 0 keeps every
-- existing row a normal record.
ALTER TABLE adopters ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;
