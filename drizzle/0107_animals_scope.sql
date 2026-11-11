-- 2026-11-11: «Formularios, contratos y controles de: Mis animales / Los animales
-- de todo el equipo» (Configuración → Avisos). NULL or 'team' = the whole team
-- (default); 'mine' = no team copy at all of forms, contracts and check-ups for
-- animals the person did not add. Read by src/lib/animalsScope.ts and the
-- follow-up cron Worker. Replaces followup_settings.onlyMyAnimals («Recordarme
-- solo los animales que cargué yo»): whoever had it on starts on 'mine'.
-- Additive and idempotent: the backfill only fills rows still NULL.
ALTER TABLE user_profiles ADD COLUMN animals_scope TEXT;
--> statement-breakpoint
UPDATE user_profiles SET animals_scope = 'mine'
WHERE animals_scope IS NULL
  AND followup_settings IS NOT NULL
  AND json_valid(followup_settings)
  AND json_extract(followup_settings, '$.onlyMyAnimals') = 1;
