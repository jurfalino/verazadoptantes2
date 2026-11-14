-- 0110: group branding (additive).
-- Why: a rescue group can carry its own look (logo, banner, theme, accent,
-- social links) on the public form/contract/catalogue pages its members share.
-- Spec: docs/superpowers/specs/2026-11-13-group-branding-design.md
-- All columns are nullable; NULL theme/accent = today's default look.
ALTER TABLE organizations ADD COLUMN logo_url TEXT;
ALTER TABLE organizations ADD COLUMN banner_url TEXT;
ALTER TABLE organizations ADD COLUMN brand_theme TEXT;
ALTER TABLE organizations ADD COLUMN brand_accent TEXT;
ALTER TABLE organizations ADD COLUMN instagram_url TEXT;
ALTER TABLE organizations ADD COLUMN facebook_url TEXT;
ALTER TABLE organizations ADD COLUMN website_url TEXT;
ALTER TABLE organizations ADD COLUMN branding_updated_at INTEGER;
ALTER TABLE organizations ADD COLUMN branding_updated_by TEXT;

-- Backfill: an explicit «Los mios» choice was stored as NULL, which from now on
-- means "never chose" (and defaults to the user's group). Keep the explicit
-- choices by writing 'self' for everyone whose audit trail says they picked it.
UPDATE user_profiles SET adoption_docs_source = 'self'
WHERE adoption_docs_source IS NULL AND user_id IN (
  SELECT u.id FROM user u JOIN audit_log a ON lower(a.user_email) = lower(u.email)
  WHERE a.action = 'adoption_docs_source_changed' AND json_extract(a.details, '$.source') = 'self');
