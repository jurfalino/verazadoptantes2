-- Parity harness for the animals/placements/adopter_events normalization.
-- Asserts the backfill preserved the adopter-facing aggregates that features
-- depend on: per-adopter average rating, adoption count, request count, plus
-- row conservation. Every SELECT below should return ZERO rows (except the
-- labelled COUNT probes, which should show 0). Run against local (sqlite3
-- local.db) and staging (wrangler d1 execute) BEFORE migrating any reads.

.headers on
.mode column

-- ── 1. Row conservation ──────────────────────────────────────────────────────
-- Every adoptions row must land in exactly one target. Non-zero "dropped" = data loss.
SELECT 'conservation' AS check_name,
  (SELECT COUNT(*) FROM adoptions) AS adoptions_total,
  (SELECT COUNT(*) FROM adoptions WHERE record_type IN ('available','foster','adoption')) AS should_be_animals,
  (SELECT COUNT(*) FROM animals) AS animals_total,
  (SELECT COUNT(*) FROM adoptions WHERE record_type IN ('observation','adoption_request','follow_up','returned_pet') AND adopter_id IS NOT NULL) AS should_be_events,
  (SELECT COUNT(*) FROM adopter_events) AS events_total,
  (SELECT COUNT(*) FROM adoptions WHERE record_type IN ('observation','adoption_request','follow_up','returned_pet') AND adopter_id IS NULL) AS dropped_events_null_adopter,
  (SELECT COUNT(*) FROM adoptions WHERE record_type IN ('foster','adoption') AND adopter_id IS NULL) AS foster_adopt_without_adopter;

-- ── 2. Per-adopter average rating parity (MISMATCH ROWS = FAIL) ───────────────
WITH old_r AS (
  SELECT adopter_id, AVG(rating) AS avg_r
  FROM adoptions WHERE adopter_id IS NOT NULL AND rating IS NOT NULL GROUP BY adopter_id
),
new_r AS (
  SELECT adopter_id, AVG(rating) AS avg_r FROM (
    SELECT adopter_id, rating FROM placements WHERE rating IS NOT NULL
    UNION ALL
    SELECT adopter_id, rating FROM adopter_events WHERE rating IS NOT NULL
  ) GROUP BY adopter_id
)
SELECT 'RATING_MISMATCH' AS fail, o.adopter_id, o.avg_r AS old_avg, n.avg_r AS new_avg
FROM old_r o LEFT JOIN new_r n ON o.adopter_id = n.adopter_id
WHERE ABS(COALESCE(o.avg_r, -999) - COALESCE(n.avg_r, -999)) > 0.0001;

-- ── 3. Per-adopter adoption-count parity (MISMATCH ROWS = FAIL) ───────────────
WITH old_c AS (SELECT adopter_id, COUNT(*) c FROM adoptions WHERE record_type='adoption' AND adopter_id IS NOT NULL GROUP BY adopter_id),
     new_c AS (SELECT adopter_id, COUNT(*) c FROM placements WHERE record_type='adoption' GROUP BY adopter_id)
SELECT 'ADOPTION_COUNT_MISMATCH' AS fail, COALESCE(o.adopter_id, n.adopter_id) AS adopter_id, COALESCE(o.c,0) old_c, COALESCE(n.c,0) new_c
FROM old_c o LEFT JOIN new_c n ON o.adopter_id = n.adopter_id
WHERE COALESCE(o.c,0) != COALESCE(n.c,0);

-- ── 4. Per-adopter request-count parity (MISMATCH ROWS = FAIL) ────────────────
WITH old_c AS (SELECT adopter_id, COUNT(*) c FROM adoptions WHERE record_type='adoption_request' AND adopter_id IS NOT NULL GROUP BY adopter_id),
     new_c AS (SELECT adopter_id, COUNT(*) c FROM adopter_events WHERE event_type='adoption_request' GROUP BY adopter_id)
SELECT 'REQUEST_COUNT_MISMATCH' AS fail, COALESCE(o.adopter_id, n.adopter_id) AS adopter_id, COALESCE(o.c,0) old_c, COALESCE(n.c,0) new_c
FROM old_c o LEFT JOIN new_c n ON o.adopter_id = n.adopter_id
WHERE COALESCE(o.c,0) != COALESCE(n.c,0);
