-- 2026-11-04 API logging audit: what a support question needs, on every call's row.
-- Which client sent it (never the IP: it would outlive the 30-day log), the
-- Cloudflare ray to find the edge request, how an exact match was decided
-- (ids, field names and verdicts only — no values, so it may outlive the
-- 90-day body purge), and whether a fuzzy answer was degraded by a D1 blip.
ALTER TABLE api_requests ADD COLUMN user_agent TEXT;
ALTER TABLE api_requests ADD COLUMN cf_ray TEXT;
ALTER TABLE api_requests ADD COLUMN client_country TEXT;
ALTER TABLE api_requests ADD COLUMN decision TEXT;
ALTER TABLE api_requests ADD COLUMN degraded INTEGER NOT NULL DEFAULT 0;
