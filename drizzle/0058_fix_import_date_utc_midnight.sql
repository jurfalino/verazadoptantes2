-- Fix off-by-one on imported activity dates.
-- The import stored dates via `new Date("YYYY-MM-DD")` = UTC midnight; the profile
-- renders them with formatShortDate's LOCAL getDate(), so in Buenos Aires (UTC-3)
-- they showed the PREVIOUS day. The code now stores NOON UTC (importDateToNoon),
-- matching the manual form. This one-time backfill shifts the already-stored
-- midnight values +12h (+43200s) so the displayed day becomes correct.
--
-- Scope: only rows at an exact UTC midnight (started_at/date % 86400 = 0) that
-- belong to imported adopters. Manual records store noon and never match; the
-- source filter also leaves any non-imported midnight rows untouched.
-- Both columns are Drizzle mode:"timestamp" = Unix SECONDS.

UPDATE placements
   SET started_at = started_at + 43200
 WHERE started_at IS NOT NULL
   AND started_at % 86400 = 0
   AND adopter_id IN (SELECT id FROM adopters WHERE source = 'imported');

UPDATE adopter_events
   SET date = date + 43200
 WHERE date IS NOT NULL
   AND date % 86400 = 0
   AND adopter_id IN (SELECT id FROM adopters WHERE source = 'imported');
