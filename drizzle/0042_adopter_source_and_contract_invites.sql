-- Migration: adopter source attribution + contract invitations (Phase 1 of
-- the auto-create-adopter-from-form workflow; see
-- .agents/plans/snoopy-exploring-iverson.md or the equivalent personal plan).
--
-- Adds:
--   adopters.source    — enum-via-text: 'manual' | 'form' | 'contract' | 'imported'
--                        Default 'manual' keeps every existing row valid.
--                        Backfilled below for rows we can reliably attribute
--                        to a form submission (formSubmissions.linkedAdopterId).
--
--   contract_invitations — new table backing the per-adopter contract
--                          token flow. One outstanding invite per animal:
--                          issuing a new token retires the prior one via
--                          server-action logic (no DB constraint needed).
--
-- Migration safety note vs 0041 (which crashed on prod because of a
-- post-backfill UNIQUE INDEX on colliding org names): this migration does
-- NOT add any UNIQUE constraint on backfilled data. The new column has a
-- NOT NULL DEFAULT so the ALTER alone keeps every existing row valid; the
-- subsequent UPDATE only refines attribution for known form-sourced rows.
-- Backfill uses a raw SQL subquery (`IN (SELECT ...)`), not Drizzle's
-- inArray binding which is broken on D1 (see docs/D1_COMPATIBILITY.md).

ALTER TABLE adopters ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';

-- Backfill: adopters that have a back-reference from a form submission
-- get source='form'. Everything else stays 'manual', including rows
-- created by /api/contract/[id]/submit pre-Phase-1 (we can't reliably
-- distinguish those without an audit trail; close enough is fine).
UPDATE adopters
SET source = 'form'
WHERE id IN (
    SELECT linked_adopter_id
    FROM form_submissions
    WHERE linked_adopter_id IS NOT NULL
);

CREATE TABLE contract_invitations (
    token TEXT PRIMARY KEY,
    animal_id TEXT NOT NULL,
    adopter_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    used_at INTEGER,
    expires_at INTEGER
);

-- For the "is there an active invite for this animal?" lookup that
-- runs every time createContractInvitation retires prior unused invites.
CREATE INDEX idx_contract_inv_animal ON contract_invitations(animal_id);
