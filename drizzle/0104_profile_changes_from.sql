-- 2026-11-08: «Avisame de cambios hechos por:» under «Cambios en tus perfiles»
-- (/settings). NULL or 'outside' = «Otros rescatistas» (default): a teammate's
-- change to your profiles creates no notice. 'team' = «Otros rescatistas y mi
-- equipo». Read by src/lib/teamChangeAudience.ts. Additive only.
ALTER TABLE user_profiles ADD COLUMN profile_changes_from TEXT;
