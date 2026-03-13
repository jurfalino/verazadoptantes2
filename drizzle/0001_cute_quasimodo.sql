-- Deprecated migration.
-- The `family_members` column on `adopters` is now created and managed
-- by later schema migrations (see 0003_greedy_frog_thor.sql).
-- Keep a harmless no-op statement so Drizzle sees a valid SQL statement.

SELECT 1;
