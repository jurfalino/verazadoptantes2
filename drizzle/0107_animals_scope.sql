-- 2026-11-11: «Formularios, contratos y controles de: Mis animales / Los animales
-- de todo el equipo» (Configuración → Avisos). NULL or 'team' = the whole team
-- (default); 'mine' = no team copy at all of forms, contracts and check-ups for
-- animals the person did not add. Read by src/lib/animalsScope.ts and the
-- follow-up cron Worker. Replaces followup_settings.onlyMyAnimals («Recordarme
-- solo los animales que cargué yo»): whoever had it on starts on 'mine'.
-- Additive. NOT re-runnable as a whole: the ALTER fails if the column already
-- exists (SQLite has no ADD COLUMN IF NOT EXISTS), so never hand-apply it ahead
-- of `wrangler d1 migrations apply` — that run would then fail and skip the
-- deploy. The backfill UPDATE alone is idempotent: it only fills rows still NULL.
-- CASE, not `json_valid(...) AND json_extract(...)`: SQLite doesn't promise to
-- test json_valid first, and json_extract raises on malformed JSON.
ALTER TABLE user_profiles ADD COLUMN animals_scope TEXT;
--> statement-breakpoint
UPDATE user_profiles SET animals_scope = 'mine'
WHERE animals_scope IS NULL
  AND followup_settings IS NOT NULL
  AND CASE WHEN json_valid(followup_settings) THEN json_extract(followup_settings, '$.onlyMyAnimals') END = 1;
