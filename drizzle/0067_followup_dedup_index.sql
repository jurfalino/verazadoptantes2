-- v2.55.20: make the follow-up cron's dedup lookup indexed.
--
-- The Worker checks, before every insert, whether it already notified this
-- (placement, slot, recipient) — previously `json_extract(metadata,'$.dedupKey')`
-- with no supporting index, so each check scanned the type-filtered slice of
-- `notifications`. That is linear in notification history and gets worse as the
-- table grows (team fan-out multiplies it by team size).
--
-- SQLite supports indexes on expressions, so the extract itself can be indexed —
-- no schema change, no backfill, and the Worker's query is unchanged.
CREATE INDEX IF NOT EXISTS idx_notif_followup_dedup
  ON notifications (user_id, json_extract(metadata, '$.dedupKey'))
  WHERE type = 'follow_up_due';
