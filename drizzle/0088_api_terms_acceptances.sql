-- /developers (Jon, 2026-10-17): any signed-in user creates their own API key
-- after accepting the API terms. One row per user and terms version accepted;
-- a new version asks again before the next key.
CREATE TABLE IF NOT EXISTS api_terms_acceptances (
    user_email TEXT NOT NULL,
    version INTEGER NOT NULL,
    accepted_at INTEGER NOT NULL,
    PRIMARY KEY (user_email, version)
);
