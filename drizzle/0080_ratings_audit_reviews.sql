-- "Calificaciones vs. notas": rows judged correct as they are ("Está bien así").
-- fingerprint = hash of rating + note at review time; any later edit re-surfaces the row.
CREATE TABLE IF NOT EXISTS ratings_audit_reviews (
    record_id TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    reviewed_by TEXT NOT NULL,
    reviewed_at INTEGER NOT NULL
);
