-- Seed data for Playwright E2E tests
-- Run with: npx wrangler d1 execute DB --local --file=tests/seed.sql
-- Uses INSERT OR REPLACE for idempotent re-runs

-- ============================================================
-- ADOPTERS (5 personas)
-- ============================================================

-- Adopters: omit source_url so seed works with or without that column (migration 0004_cute_sunfire)
INSERT OR REPLACE INTO adopters (id, name, contact_info, address_info, family_members, notes, status, added_by, created_at, updated_at) VALUES
('test-adopter-1', 'María García López', 'Tel: 555-1234, Email: maria@example.com', 'Calle Falsa 123, Buenos Aires', 'Juan García (esposo), Lucía García (hija)', 'Excelente adoptante, tiene experiencia con mascotas. Casa con patio grande.', '5', 'test-seed', strftime('%s','now'), strftime('%s','now'));

INSERT OR REPLACE INTO adopters (id, name, contact_info, address_info, family_members, notes, status, added_by, created_at, updated_at) VALUES
('test-adopter-2', 'Carlos Danger', 'Tel: 555-9999', NULL, NULL, 'Reportado por maltrato animal. Múltiples denuncias.', '1', 'test-seed', strftime('%s','now'), strftime('%s','now'));

INSERT OR REPLACE INTO adopters (id, name, contact_info, address_info, family_members, notes, status, added_by, created_at, updated_at) VALUES
('test-adopter-3', 'Ana Martínez', 'Tel: 555-5555', 'Av. Libertador 456', NULL, NULL, '3', 'test-seed', strftime('%s','now'), strftime('%s','now'));

INSERT OR REPLACE INTO adopters (id, name, contact_info, address_info, family_members, notes, status, added_by, created_at, updated_at) VALUES
('test-adopter-4', 'Roberto Fernández', 'Tel: 555-7777, WhatsApp: 555-7778', 'Barrio Norte 789', 'Patricia Fernández (esposa)', 'Adopta regularmente. Voluntario en refugio local.', '4', 'test-seed', strftime('%s','now'), strftime('%s','now'));

INSERT OR REPLACE INTO adopters (id, name, contact_info, address_info, family_members, notes, status, added_by, created_at, updated_at) VALUES
('test-adopter-5', 'Nueva Persona', NULL, NULL, NULL, NULL, '5', 'test-seed', strftime('%s','now'), strftime('%s','now'));

-- ============================================================
-- ADOPTIONS (6 records)
-- ============================================================

-- María: 2 adoptions
INSERT OR REPLACE INTO adoptions (id, adopter_id, animal_name, species, details, status, rating, record_type, date, added_by) VALUES
('test-adoption-1', 'test-adopter-1', 'Luna', 'dog', 'Perra mestiza rescatada de la calle', 'completed', 5, 'adoption', strftime('%s','now','-60 days'), 'test-seed');

INSERT OR REPLACE INTO adoptions (id, adopter_id, animal_name, species, details, status, rating, record_type, date, added_by) VALUES
('test-adoption-2', 'test-adopter-1', 'Michi', 'cat', 'Gatito naranja de 3 meses', 'completed', 5, 'adoption', strftime('%s','now','-30 days'), 'test-seed');

-- Carlos: 1 observation
INSERT OR REPLACE INTO adoptions (id, adopter_id, animal_name, species, details, status, rating, record_type, date, added_by) VALUES
('test-adoption-3', 'test-adopter-2', NULL, NULL, 'Se observó condiciones inadecuadas en la vivienda', NULL, 1, 'observation', strftime('%s','now','-15 days'), 'test-seed');

-- Roberto: 3 adoptions
-- Omit source_url so seed works with or without that column (migration 0010)
INSERT OR REPLACE INTO adoptions (id, adopter_id, animal_name, species, details, status, rating, record_type, date, added_by) VALUES
('test-adoption-4', 'test-adopter-4', 'Firulais', 'dog', 'Golden retriever adulto', 'completed', 4, 'adoption', strftime('%s','now','-90 days'), 'test-seed');

INSERT OR REPLACE INTO adoptions (id, adopter_id, animal_name, species, details, status, rating, record_type, date, added_by) VALUES
('test-adoption-5', 'test-adopter-4', 'Pelusa', 'cat', 'Gata siamesa', 'completed', 5, 'adoption', strftime('%s','now','-45 days'), 'gatitosolivos@gmail.com');

INSERT OR REPLACE INTO adoptions (id, adopter_id, animal_name, species, details, status, rating, record_type, date, added_by) VALUES
('test-adoption-6', 'test-adopter-4', 'Rocky', 'dog', 'Cachorro bulldog francés', 'completed', 4, 'follow_up', strftime('%s','now','-10 days'), 'test-seed');

-- ============================================================
-- HISTORY (2 entries — enables search-by-old-name)
-- ============================================================

INSERT OR REPLACE INTO adopter_history (id, adopter_id, changed_by, changes, changed_at) VALUES
('test-history-1', 'test-adopter-1', 'test-seed', '{"name":{"old":"María Gómez","new":"María García López"}}', strftime('%s','now','-20 days'));

INSERT OR REPLACE INTO adopter_history (id, adopter_id, changed_by, changes, changed_at) VALUES
('test-history-2', 'test-adopter-2', 'test-seed', '{"status":{"old":"3","new":"1"}}', strftime('%s','now','-10 days'));

-- ============================================================
-- FLAGS (1 — Ana flagged as duplicate of María)
-- ============================================================

INSERT OR REPLACE INTO adopter_flags (id, adopter_id, flagged_by, reason, target_adopter_id, details, created_at) VALUES
('test-flag-1', 'test-adopter-3', 'test-seed', 'duplicate', 'test-adopter-1', 'Possible duplicate profile — same phone number', strftime('%s','now','-5 days'));

-- ============================================================
-- APP CONFIG (feature flags)
-- ============================================================

INSERT OR REPLACE INTO app_config (key, value, updated_at, updated_by) VALUES
('ENABLE_FACEBOOK_IMPORT', 'true', strftime('%s','now'), 'test-seed');

INSERT OR REPLACE INTO app_config (key, value, updated_at, updated_by) VALUES
('ENABLE_AI_EXTRACTION', 'false', strftime('%s','now'), 'test-seed');

-- ============================================================
-- USER (admin account for authenticated tests)
-- ============================================================

INSERT OR REPLACE INTO user (id, name, email, emailVerified, image) VALUES
('test-admin-id', 'Test Admin', 'gatitosolivos@gmail.com', strftime('%s','now'), NULL);

-- User profile: country confirmed so CountryConfirmBanner doesn't block the page
INSERT OR REPLACE INTO user_profiles (user_id, country, country_confirmed) VALUES
('test-admin-id', 'AR', 1);

-- ============================================================
-- DUPLICATE DETECTION SEED DATA
-- ============================================================

-- Candidate pair: María (test-adopter-1) ↔ Ana (test-adopter-3)
-- Medium confidence, pending status — should appear in profile banner, search badge, flagging suggestions
INSERT OR REPLACE INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, match_values, score, confidence, status, detected_at) VALUES
('test-dup-candidate-1', 'test-adopter-1', 'test-adopter-3', '["phone","name_word"]', '{"phone":"5555555","name_word":["garcia"]}', 4, 'medium', 'pending', strftime('%s','now'));

-- Candidate pair: Roberto (test-adopter-4) ↔ Carlos (test-adopter-2)
-- Low confidence, pending — should NOT appear in search badge (filtered out)
INSERT OR REPLACE INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, match_values, score, confidence, status, detected_at) VALUES
('test-dup-candidate-2', 'test-adopter-4', 'test-adopter-2', '["name_word"]', '{"name_word":["fernandez"]}', 1, 'low', 'pending', strftime('%s','now'));

-- Tokens: María's phone (shared with Ana's profile contact info)
INSERT OR REPLACE INTO duplicate_tokens (id, adopter_id, token_type, token_value) VALUES
('test-token-1', 'test-adopter-1', 'phone', '5551234');
INSERT OR REPLACE INTO duplicate_tokens (id, adopter_id, token_type, token_value) VALUES
('test-token-2', 'test-adopter-3', 'phone', '5555555');
INSERT OR REPLACE INTO duplicate_tokens (id, adopter_id, token_type, token_value) VALUES
('test-token-3', 'test-adopter-1', 'name_word', 'garcia');
INSERT OR REPLACE INTO duplicate_tokens (id, adopter_id, token_type, token_value) VALUES
('test-token-4', 'test-adopter-3', 'name_word', 'martinez');
