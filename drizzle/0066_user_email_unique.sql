-- Both login methods (Google OAuth and email OTP) resolve accounts by
-- email with LIMIT 1; a duplicate row would silently split one person
-- across providers. Pre-flight duplicate check ran clean on staging and
-- prod (2026-09-06) before this migration shipped.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_email_unique ON user(email);
