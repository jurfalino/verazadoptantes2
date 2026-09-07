-- Email OTP login codes: single-use 6-digit codes, HMAC-SHA-256 hashed
-- with AUTH_SECRET. Rows are short-lived: retired on consume/replace,
-- purged after 24h opportunistically by requestEmailOtp. request_ip is
-- CF-Connecting-IP, kept only for per-IP rate limiting and deleted with
-- the row.

CREATE TABLE IF NOT EXISTS email_otp_codes (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    consumed_at INTEGER,
    request_ip TEXT
);

CREATE INDEX IF NOT EXISTS idx_email_otp_email_created ON email_otp_codes(email, created_at);
CREATE INDEX IF NOT EXISTS idx_email_otp_ip_created ON email_otp_codes(request_ip, created_at);
