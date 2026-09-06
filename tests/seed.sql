-- Seed data for Playwright E2E tests
-- Run with: npx wrangler d1 execute DB --local --file=tests/seed.sql
-- Uses INSERT OR REPLACE for idempotent re-runs

-- ============================================================
-- ADOPTERS (5 personas)
-- ============================================================

-- Adopters: country set via UPDATE below (resilient to column not existing)
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

-- Set country on all test adopters (matches admin user's country 'AR' so geo-filtered search returns results)
UPDATE adopters SET country = 'AR' WHERE id IN ('test-adopter-1','test-adopter-2','test-adopter-3','test-adopter-4','test-adopter-5');


-- ============================================================
-- ADOPTIONS (6 records)
-- ============================================================

-- Normalized model: available/foster/adoption → animals (+ placements); the 4
-- event types → adopter_events. Ids preserved (animals.id / adopter_events.id =
-- old adoptions.id) so tests referencing test-adoption-N still resolve via the
-- `adoptions` compat view.
-- Animals (identity) for the placed adoptions:
INSERT OR REPLACE INTO animals (id, name, species, details, added_by, source_url, created_at, updated_at) VALUES
('test-adoption-1', 'Luna', 'dog', 'Perra mestiza rescatada de la calle', 'test-seed', NULL, strftime('%s','now','-60 days'), strftime('%s','now','-60 days')),
('test-adoption-2', 'Michi', 'cat', 'Gatito naranja de 3 meses', 'test-seed', NULL, strftime('%s','now','-30 days'), strftime('%s','now','-30 days')),
('test-adoption-4', 'Firulais', 'dog', 'Golden retriever adulto', 'test-seed', 'https://www.facebook.com/groups/123/posts/456', strftime('%s','now','-90 days'), strftime('%s','now','-90 days')),
('test-adoption-5', 'Pelusa', 'cat', 'Gata siamesa', 'gatitosolivos@gmail.com', NULL, strftime('%s','now','-45 days'), strftime('%s','now','-45 days'));

-- Active placements (custody) for those animals:
INSERT OR REPLACE INTO placements (id, animal_id, adopter_id, record_type, started_at, ended_at, status, rating, recorded_by) VALUES
('test-placement-1', 'test-adoption-1', 'test-adopter-1', 'adoption', strftime('%s','now','-60 days'), NULL, 'completed', 5, 'test-seed'),
('test-placement-2', 'test-adoption-2', 'test-adopter-1', 'adoption', strftime('%s','now','-30 days'), NULL, 'completed', 5, 'test-seed'),
('test-placement-4', 'test-adoption-4', 'test-adopter-4', 'adoption', strftime('%s','now','-90 days'), NULL, 'completed', 4, 'test-seed'),
('test-placement-5', 'test-adoption-5', 'test-adopter-4', 'adoption', strftime('%s','now','-45 days'), NULL, 'completed', 5, 'gatitosolivos@gmail.com');

-- Adopter events: Carlos's observation + Roberto's follow-up.
INSERT OR REPLACE INTO adopter_events (id, adopter_id, event_type, animal_name, species, status, rating, details, date, recorded_by) VALUES
('test-adoption-3', 'test-adopter-2', 'observation', NULL, NULL, NULL, 1, 'Se observó condiciones inadecuadas en la vivienda', strftime('%s','now','-15 days'), 'test-seed'),
('test-adoption-6', 'test-adopter-4', 'follow_up', 'Rocky', 'dog', 'completed', 4, 'Cachorro bulldog francés', strftime('%s','now','-10 days'), 'test-seed');

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

INSERT OR REPLACE INTO app_config (key, value, updated_at, updated_by) VALUES
('ENABLE_ANIMALS_FOR_ADOPTION', 'true', strftime('%s','now'), 'test-seed');

-- ============================================================
-- USER (admin account for authenticated tests)
-- ============================================================

INSERT OR REPLACE INTO user (id, name, email, emailVerified, image) VALUES
('test-admin-id', 'Test Admin', 'gatitosolivos@gmail.com', strftime('%s','now'), NULL);

INSERT OR REPLACE INTO user (id, name, email, emailVerified, image) VALUES
('test-user-id', 'Test User', 'testuser@example.com', strftime('%s','now'), NULL);

-- User profiles: country confirmed + terms accepted so CountryConfirmBanner doesn't block the page
-- terms_version must match CURRENT_TERMS_VERSION (currently 1) from src/config/constants.ts
INSERT OR REPLACE INTO user_profiles (user_id, country, country_confirmed, terms_version, terms_accepted_at) VALUES
('test-admin-id', 'AR', 1, 1, strftime('%s','now'));

INSERT OR REPLACE INTO user_profiles (user_id, country, country_confirmed, terms_version, terms_accepted_at) VALUES
('test-user-id', 'AR', 1, 1, strftime('%s','now'));

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

-- ============================================================
-- ANIMAL TIMELINE FIXTURES (v2.55.15 — animal-profile.authed.spec.ts)
-- Fully isolated: dedicated fixture adopters so no shared-seed counts change.
-- Owned by the admin session email so the strictly owner-gated
-- /my-animals/[id] page can render them.
-- ============================================================

INSERT OR REPLACE INTO adopters (id, name, contact_info, status, added_by, created_at, updated_at) VALUES
('test-adopter-fixture-tl1', 'Fátima Timeline', 'Tel: 555-0201', '5', 'test-seed', strftime('%s','now'), strftime('%s','now')),
('test-adopter-fixture-tl2', 'Tránsito Timeline', 'Tel: 555-0202', '5', 'test-seed', strftime('%s','now'), strftime('%s','now'));
UPDATE adopters SET country = 'AR' WHERE id IN ('test-adopter-fixture-tl1','test-adopter-fixture-tl2');

INSERT OR REPLACE INTO animals (id, name, species, details, sex, color, neutered, added_by, created_at, updated_at) VALUES
('test-animal-fixture-1', 'Timon', 'dog', 'Perro fixture para la línea de vida', 'macho', 'marrón', 0, 'gatitosolivos@gmail.com', strftime('%s','now','-120 days'), strftime('%s','now'));

-- Custody trail: an ENDED foster span + the ACTIVE adoption.
INSERT OR REPLACE INTO placements (id, animal_id, adopter_id, record_type, started_at, ended_at, status, rating, recorded_by) VALUES
('test-plc-fixture-1f', 'test-animal-fixture-1', 'test-adopter-fixture-tl2', 'foster', strftime('%s','now','-120 days'), strftime('%s','now','-80 days'), 'completed', NULL, 'gatitosolivos@gmail.com'),
('test-plc-fixture-1a', 'test-animal-fixture-1', 'test-adopter-fixture-tl1', 'adoption', strftime('%s','now','-80 days'), NULL, 'completed', 5, 'gatitosolivos@gmail.com');

-- A follow-up LINKED to the animal (the 0062 backfill is a no-op on the empty
-- CI database, so the linkage is seeded directly).
INSERT OR REPLACE INTO adopter_events (id, adopter_id, event_type, animal_id, placement_id, animal_name, species, rating, details, date, recorded_by) VALUES
('test-event-fixture-tl1', 'test-adopter-fixture-tl1', 'follow_up', 'test-animal-fixture-1', 'test-plc-fixture-1a', 'Timon', 'dog', 5, 'Muy bien adaptado a la casa nueva', strftime('%s','now','-50 days'), 'gatitosolivos@gmail.com');

-- A care event (vaccination) during the foster span.
INSERT OR REPLACE INTO animal_events (id, animal_id, event_type, date, details, recorded_by) VALUES
('test-aevent-fixture-tl1', 'test-animal-fixture-1', 'vaccination', strftime('%s','now','-100 days'), 'Quíntuple, primera dosis', 'gatitosolivos@gmail.com');
