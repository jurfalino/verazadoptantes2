-- Pendientes de revisar D (spec: 2026-10-25 pendientes D).
-- The language each person chose in the app, so notification emails go out in it (D38).
ALTER TABLE user_profiles ADD COLUMN locale TEXT;

-- Duplicate pairs a viewer hid from their pending list (D27). pair_key = sorted ids joined with '|'.
CREATE TABLE IF NOT EXISTS pending_pair_hidden (
    viewer_email TEXT NOT NULL,
    pair_key TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (viewer_email, pair_key)
);
