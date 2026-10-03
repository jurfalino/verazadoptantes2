-- Custom adoption form + contract per user/group (2026-09). Three new tables:
-- adoption_doc_settings (one row per owner: hidden form steps + current
-- contract version), contract_versions (append-only while signed — a saved
-- edit never mutates a version an adopter may have open), and
-- signed_contracts (one row per signature, standard or custom). See
-- docs/superpowers/specs/2026-09-29-custom-adoption-docs-design.md §1.1-1.2, 1.4.

CREATE TABLE IF NOT EXISTS adoption_doc_settings (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL,          -- 'user' | 'org'
  owner_id TEXT NOT NULL,            -- user email (lower-cased) | organizations.id
  hidden_steps TEXT,                 -- JSON string[] of step ids — NULL = none hidden
  contract_version_id TEXT,          -- current contract_versions.id — NULL = standard contract
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL           -- actor email
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_adoption_doc_settings_owner ON adoption_doc_settings(owner_type, owner_id);

CREATE TABLE IF NOT EXISTS contract_versions (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  sections_json TEXT NOT NULL,       -- {"2"?: RichDoc, "3"?: RichDoc, "4"?: RichDoc} — absent key = standard text
  content_hash TEXT NOT NULL,        -- sha256 hex of canonical sections_json
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  first_signed_at INTEGER,           -- NULL until first signature — once set, row is immutable & never deleted
  replaced_at INTEGER                -- set when a newer version becomes current
);
CREATE INDEX IF NOT EXISTS idx_contract_versions_owner ON contract_versions(owner_type, owner_id);

CREATE TABLE IF NOT EXISTS signed_contracts (
  id TEXT PRIMARY KEY,
  animal_id TEXT NOT NULL,
  adopter_id TEXT,                   -- adopter the signature was attached to
  contract_version_id TEXT,          -- NULL = standard contract
  standard_version TEXT,             -- STANDARD_CONTRACT_VERSION the page reported (NULL if an old SPA sent nothing)
  locale TEXT,
  content_hash TEXT,                 -- contract_versions.content_hash when custom — NULL for standard
  file_key TEXT,                     -- R2 key of the uploaded PDF/image
  via TEXT NOT NULL,                 -- 'token' | 'open'
  signed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signed_contracts_animal ON signed_contracts(animal_id);
