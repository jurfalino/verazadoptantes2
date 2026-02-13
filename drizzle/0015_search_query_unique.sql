-- Add unique constraint to searches.query for upsert (onConflictDoUpdate) support
CREATE UNIQUE INDEX `searches_query_unique` ON `searches` (`query`);
