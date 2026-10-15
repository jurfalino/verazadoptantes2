-- Form selfies move to private storage (src/lib/contractStorage.ts, prefix
-- selfies/): the key lives here, written only by the form submit route; the
-- picture opens through /api/files/selfie/{submissionId} for whoever may see
-- that form's results. selfie_url stays for older public uploads until moved.
ALTER TABLE form_submissions ADD COLUMN selfie_key TEXT;
