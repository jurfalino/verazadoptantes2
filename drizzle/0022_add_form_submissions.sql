-- PetShield Form Submissions
CREATE TABLE IF NOT EXISTS form_submissions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    address TEXT,
    latitude TEXT,
    longitude TEXT,
    selfie_url TEXT,
    species TEXT,
    life_stage TEXT,
    special_needs INTEGER DEFAULT 0,
    intent TEXT,
    household TEXT,
    status TEXT DEFAULT 'pending',
    linked_adopter_id TEXT,
    notification_id TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_form_user ON form_submissions (user_id);
CREATE INDEX IF NOT EXISTS idx_form_status ON form_submissions (status);
