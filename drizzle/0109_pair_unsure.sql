-- 2026-11-12 (Jon): «No sé» on a form's «¿Es la misma persona?». The rescuer
-- evaluating a form must answer each possible duplicate before sending a
-- contract; «No sé» counts as an answer. The pair stays pending (profiles stay
-- separate) and the other profile's owner is asked. These two columns record
-- who answered «No sé» and when; «Cambiar mi respuesta» clears them.
-- Additive, no backfill: every existing pair starts unanswered.
ALTER TABLE duplicate_candidates ADD COLUMN unsure_by TEXT;
--> statement-breakpoint
ALTER TABLE duplicate_candidates ADD COLUMN unsure_at INTEGER;
