-- Add nullable `locale` to contract_invitations: the language the sharing
-- rescuer used when issuing the invite. Drives the contract-app's whole-screen
-- language. Nullable for legacy rows (contract-app falls back to 'es').
ALTER TABLE contract_invitations ADD COLUMN locale text;
