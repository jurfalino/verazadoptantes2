-- v2.56.126: the shared health record gets its own address, one per adoption.
--
-- It was keyed on the ANIMAL, which has two problems. A returned-then-rehomed
-- animal revives the first family's old link, because the address never
-- changed. And the obvious alternative — key it on the placement id — is not
-- safe here: `_recordWrite` creates a placement with the id `<animal id>-plc`
-- when the animal is created with a home already attached, which is 60 of the
-- 105 placements in production. The animal id is public (it is in the listing
-- URL), so those addresses would be guessable.
--
-- So each placement carries its own random token. It is minted when the
-- placement is created, it dies with the placement, and a later adoption of
-- the same animal mints a new one — the old family's link stays dead.
ALTER TABLE placements ADD COLUMN health_token TEXT;

-- randomblob(16) is 128 bits, the same order as the UUIDs used elsewhere, and
-- SQLite seeds it per row. Every placement gets one, ended ones included: the
-- route checks `ended_at IS NULL` anyway, and a column with no holes cannot
-- produce a share button that has nothing to share.
UPDATE placements
   SET health_token = lower(hex(randomblob(16)))
 WHERE health_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_placements_health_token
    ON placements(health_token);
