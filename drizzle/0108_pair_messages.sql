-- 2026-11-11: «Te escribió» lives on the pair. One row per message sent with
-- «Escribirle a …» on a merge request (src/app/actions/pairMessages.ts), shown in
-- the open pair in «Pendientes de revisar». Before this the text lived only in
-- the pair_message notifications (one per recipient) and their emails.
-- Additive. The backfill copies each message once (not once per recipient):
-- the earliest notification of a (request, sender, text) within 60 seconds.
-- It skips notifications written by the new code (they carry messageId) and
-- messages already copied, so it can re-run safely.
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
  json_extract(n.metadata, '$.requestId'),
  lower(trim(json_extract(n.metadata, '$.replyTo'))),
  json_extract(n.metadata, '$.fromName'),
  COALESCE(json_extract(n.metadata, '$.template.params.message'), n.body),
  n.created_at
FROM notifications n
WHERE n.type = 'pair_message'
  AND json_valid(n.metadata)
  AND json_extract(n.metadata, '$.messageId') IS NULL
  AND json_type(n.metadata, '$.requestId') = 'text'
  AND json_type(n.metadata, '$.replyTo') = 'text'
  AND NOT EXISTS (
    SELECT 1 FROM notifications e
    WHERE e.type = 'pair_message'
      AND json_valid(e.metadata)
      AND json_extract(e.metadata, '$.requestId') = json_extract(n.metadata, '$.requestId')
      AND lower(trim(json_extract(e.metadata, '$.replyTo'))) = lower(trim(json_extract(n.metadata, '$.replyTo')))
      AND COALESCE(json_extract(e.metadata, '$.template.params.message'), e.body) = COALESCE(json_extract(n.metadata, '$.template.params.message'), n.body)
      AND ((e.created_at < n.created_at AND e.created_at >= n.created_at - 60) OR (e.created_at = n.created_at AND e.id < n.id))
  )
  AND NOT EXISTS (
    SELECT 1 FROM pair_messages p
    WHERE p.request_id = json_extract(n.metadata, '$.requestId')
      AND p.sender_email = lower(trim(json_extract(n.metadata, '$.replyTo')))
      AND p.body = COALESCE(json_extract(n.metadata, '$.template.params.message'), n.body)
      AND abs(p.created_at - n.created_at) <= 60
      AND p.id <> 'pm-' || n.id
  );
