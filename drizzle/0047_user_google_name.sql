-- v2.18.6: preserve the original Google OAuth display name as a sibling
-- column so admins can see both "display name" (user.name, customizable via
-- /settings) AND "Google account name" (user.google_name, refreshed on
-- every sign-in) when they differ.
--
-- Before v2.18.5 the auth callback overwrote user.name with whatever
-- Google reported on every sign-in (the "WTF my display name is reset
-- every single time I sign in" bug). v2.18.5 swapped to
-- COALESCE(name, ?) so the user's custom name sticks — but that also
-- means we no longer see Google's current value anywhere. This column
-- restores that visibility for the admin oversight surface without
-- regressing the user's ability to customize their display name.

ALTER TABLE user ADD COLUMN google_name TEXT;

-- Initial backfill — seed google_name with the current name so the column
-- isn't all-NULL on day one. For users who customized their display name
-- via /settings before v2.18.5, this backfill captures the custom value
-- rather than the unrecoverable Google original. The next time each user
-- signs in, ensureUserProfile rewrites google_name from Google's actual
-- value via COALESCE(?, google_name) — so the staleness self-heals as
-- users log in.
UPDATE user SET google_name = name WHERE google_name IS NULL;
