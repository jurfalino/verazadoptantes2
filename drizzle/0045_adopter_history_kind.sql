-- 0045_adopter_history_kind.sql
-- Distinguishes 'edit' rows (mutations of the core record by owner/admin via
-- saveAdopter / appendToExistingAdopter) from 'contribution' rows (additive
-- writes by any authenticated user via addContactEntry). The PII visibility
-- resolver counts only kind='edit' rows toward editor status, so contributing
-- data does NOT silently grant full PII visibility on the profile.
--
-- Existing rows are all true edits (the contribution path didn't exist yet)
-- so DEFAULT 'edit' is the correct backfill.
ALTER TABLE adopter_history ADD COLUMN kind TEXT NOT NULL DEFAULT 'edit';
