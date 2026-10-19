-- v2.56.202: people who created keys at /developers before access needed approval
-- (2.56.197–200, staging only) are grandfathered as approved, so their keys keep
-- working under the per-call access check and Admin → API shows them truthfully.
INSERT OR IGNORE INTO api_access (user_email, status, decided_at, decided_by, note)
SELECT DISTINCT owner_email, 'approved', strftime('%s','now'), 'migration-0090', 'Self-created keys before approval existed'
FROM api_keys
WHERE created_by = owner_email AND revoked_at IS NULL;
