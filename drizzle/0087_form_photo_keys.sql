-- Adoption-form photos (spec 2026-10-14 release 2): up to 3 of the home's
-- protection and 1 of where the animal sleeps, in private storage
-- (src/lib/contractStorage.ts, prefix form-photos/). JSON [{ kind, key }],
-- written only by the form submit route; each opens through
-- /api/files/form-photo/{submissionId}/{n} for whoever may see that form.
ALTER TABLE form_submissions ADD COLUMN photo_keys TEXT;
