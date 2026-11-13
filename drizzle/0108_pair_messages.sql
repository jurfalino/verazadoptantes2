-- 2026-11-11: «Te escribió» lives on the pair. One row per message sent with
-- «Escribirle a …» on a merge request (src/app/actions/pairMessages.ts), shown in
-- the open pair in «Pendientes de revisar». Before this the text lived only in
-- the pair_message notifications (one per recipient) and their emails.
-- Additive. The backfill copies each message once (not once per recipient):
-- the earliest notification of a (request, sender, text) within 60 seconds.
-- It skips notifications written by the new code (they carry messageId) and
-- messages already copied, so it can re-run safely. Every JSON read is
-- `CASE WHEN json_valid(x) THEN json_extract(x, …) END`: SQLite doesn't promise
-- to test json_valid first, and json_extract / json_type raise on malformed JSON.
CREATE TABLE IF NOT EXISTS pair_messages (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL,
  sender_email TEXT NOT NULL,
  sender_name TEXT,
  body TEXT NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_pair_messages_request ON pair_messages (request_id, created_at);
--> statement-breakpoint
INSERT OR IGNORE INTO pair_messages (id, request_id, sender_email, sender_name, body, created_at)
SELECT 'pm-' || n.id,
  CASE WHEN json_valid(n.metadata) THEN json_extract(n.metadata, '$.requestId') END,
  lower(trim(CASE WHEN json_valid(n.metadata) THEN json_extract(n.metadata, '$.replyTo') END)),
  CASE WHEN json_valid(n.metadata) THEN json_extract(n.metadata, '$.fromName') END,
  COALESCE(CASE WHEN json_valid(n.metadata) THEN json_extract(n.metadata, '$.template.params.message') END, n.body),
  n.created_at
FROM notifications n
WHERE n.type = 'pair_message'
  AND json_valid(n.metadata)
  AND CASE WHEN json_valid(n.metadata) THEN json_extract(n.metadata, '$.messageId') END IS NULL
  AND CASE WHEN json_valid(n.metadata) THEN json_type(n.metadata, '$.requestId') END = 'text'
  AND CASE WHEN json_valid(n.metadata) THEN json_type(n.metadata, '$.replyTo') END = 'text'
  AND NOT EXISTS (
    SELECT 1 FROM notifications e
    WHERE e.type = 'pair_message'
      AND json_valid(e.metadata)
      AND CASE WHEN json_valid(e.metadata) THEN json_extract(e.metadata, '$.requestId') END = CASE WHEN json_valid(n.metadata) THEN json_extract(n.metadata, '$.requestId') END
      AND lower(trim(CASE WHEN json_valid(e.metadata) THEN json_extract(e.metadata, '$.replyTo') END)) = lower(trim(CASE WHEN json_valid(n.metadata) THEN json_extract(n.metadata, '$.replyTo') END))
      AND COALESCE(CASE WHEN json_valid(e.metadata) THEN json_extract(e.metadata, '$.template.params.message') END, e.body) = COALESCE(CASE WHEN json_valid(n.metadata) THEN json_extract(n.metadata, '$.template.params.message') END, n.body)
      AND ((e.created_at < n.created_at AND e.created_at >= n.created_at - 60) OR (e.created_at = n.created_at AND e.id < n.id))
  )
  AND NOT EXISTS (
    SELECT 1 FROM pair_messages p
    WHERE p.request_id = CASE WHEN json_valid(n.metadata) THEN json_extract(n.metadata, '$.requestId') END
      AND p.sender_email = lower(trim(CASE WHEN json_valid(n.metadata) THEN json_extract(n.metadata, '$.replyTo') END))
      AND p.body = COALESCE(CASE WHEN json_valid(n.metadata) THEN json_extract(n.metadata, '$.template.params.message') END, n.body)
      AND abs(p.created_at - n.created_at) <= 60
      AND p.id <> 'pm-' || n.id
  );
