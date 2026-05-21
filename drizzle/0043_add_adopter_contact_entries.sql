-- Migration: structured, categorized contact methods for adopters.
--
-- Adds:
--   adopters.contact_entries — JSON array of ContactEntry objects
--                              ({type,value,label?}); see src/lib/contactEntries.ts.
--
-- The existing adopters.contact_info free-text blob is kept and, for every
-- new/edited row going forward, derived from contact_entries. Pre-migration
-- rows keep contact_entries = NULL and continue to render from the blob, so
-- this ALTER alone keeps every existing row valid. Nullable, no default,
-- no UNIQUE constraint — additive and backfill-free.

ALTER TABLE adopters ADD COLUMN contact_entries TEXT;
