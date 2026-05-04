-- Deprecate the legacy free-text user_profiles.organization column.
-- It was only ever written by the /admin/users edit form and was never synced
-- with the real org/group system (organizations + org_members tables introduced
-- by migrations 0028–0030). The /admin/users column showed it as "always empty"
-- because users who joined orgs via /organizations never landed a value here.
--
-- Real org membership now joins through org_members in the /api/admin/users GET
-- query and the new /admin/organizations admin page.
ALTER TABLE user_profiles DROP COLUMN organization;
