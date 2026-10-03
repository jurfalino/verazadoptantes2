-- Custom adoption docs: per-user source choice + which form steps a submission showed.
ALTER TABLE user_profiles ADD COLUMN adoption_docs_source TEXT;
ALTER TABLE form_submissions ADD COLUMN shown_steps TEXT;
