-- 2026-11-12 (Jon): «No sé» on a form's «¿Es la misma persona?». The rescuer
-- evaluating a form must answer each possible duplicate before giving the
-- person an animal; «No sé» counts as an answer for the rescuer's group only.
-- The pair stays pending (profiles stay separate) and the other profile's
-- owner is asked. Keyed by pair_key (the two adopter ids, sorted, joined by
-- '|'), not by duplicate_candidates.id, because the admin Scan rebuilds those
-- rows with new ids. withdrawn = 1 after «Cambiar mi respuesta»; asked_at is
-- when the other side was last asked (so toggling doesn't email them again).
-- Additive, no backfill.
CREATE TABLE IF NOT EXISTS pair_unsure (
  pair_key TEXT NOT NULL,
  asker_email TEXT NOT NULL,
  answered_at INTEGER DEFAULT (strftime('%s', 'now')),
  asked_at INTEGER,
  withdrawn INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (pair_key, asker_email)
);
