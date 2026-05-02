-- Backfill adopter.notes into observation adoption records.
-- Idempotent: ID prefix `obs-migrated-` + the NOT IN guard mean re-runs are no-ops.
-- After this migration runs, the adopter.notes column stays in place (read-only) for
-- one release as a safety net before being dropped in a follow-up migration.
INSERT INTO adoptions (id, adopter_id, details, status, date, added_by, record_type)
SELECT
    'obs-migrated-' || a.id AS id,
    a.id AS adopter_id,
    a.notes AS details,
    NULL AS status,
    COALESCE(a.created_at, CAST(strftime('%s', 'now') AS INTEGER)) AS date,
    COALESCE(a.added_by, 'system-migration') AS added_by,
    'observation' AS record_type
FROM adopters a
WHERE a.notes IS NOT NULL
  AND TRIM(a.notes) <> ''
  AND NOT EXISTS (
      SELECT 1 FROM adoptions o
      WHERE o.id = 'obs-migrated-' || a.id
  );
