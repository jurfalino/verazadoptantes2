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

INSERT OR REPLACE INTO app_config (key, value, updated_at, updated_by) VALUES
('ENABLE_FOLLOWUPS', 'true', strftime('%s','now'), 'test-seed');

-- Email OTP login: flag on so the login modal renders the email option.
-- No RESEND_API_KEY in test env → requestEmailOtp's dev fallback skips the
-- actual send; the spec overwrites the stored code_hash with a known value.
INSERT OR REPLACE INTO app_config (key, value, updated_at, updated_by) VALUES
('ENABLE_EMAIL_OTP', 'true', strftime('%s','now'), 'test-seed');

-- Household members: ON in production since 2026-09-03, so ON here too. It was
-- missing, which meant no spec ever exercised the profile path real users see —
-- how family text typed on the create form went invisible unnoticed (v2.56.62).
INSERT OR REPLACE INTO app_config (key, value, updated_at, updated_by) VALUES
('ENABLE_HOUSEHOLD_MEMBERS', 'true', strftime('%s','now'), 'test-seed');

-- Custom adoption form + contract per user/group: ON so the API-level checks
-- in tests/adoption-docs.spec.ts (public form/contract resolution, signed
-- versions) run against real SQL. No spec drives the settings UI or the
-- form-step / contract-section editors yet.
INSERT OR REPLACE INTO app_config (key, value, updated_at, updated_by) VALUES
('ENABLE_CUSTOM_ADOPTION_DOCS', 'true', strftime('%s','now'), 'test-seed');

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

-- v2.56.105: an animal whose 30-day check-in is DUE right now — adopted 35 days
-- ago (window is 30+21) with NO follow-up to satisfy it. Its own animal and its
-- own adopter, because making a due slot on `test-animal-fixture-1` means aging
-- its placement and deleting its seeded follow-up, which four sibling tests
-- assert on.
INSERT OR REPLACE INTO adopters (id, name, contact_info, status, added_by, created_at, updated_at) VALUES
('test-adopter-fixture-due', 'Due Timeline', 'Tel: 555-0203', '5', 'test-seed', strftime('%s','now'), strftime('%s','now'));
UPDATE adopters SET country = 'AR' WHERE id = 'test-adopter-fixture-due';

INSERT OR REPLACE INTO animals (id, name, species, details, sex, color, neutered, added_by, created_at, updated_at) VALUES
('test-animal-fixture-due', 'Pendiente', 'cat', 'Fixture con un control vencido', 'hembra', 'gris', 1, 'gatitosolivos@gmail.com', strftime('%s','now','-40 days'), strftime('%s','now'));

INSERT OR REPLACE INTO placements (id, animal_id, adopter_id, record_type, started_at, ended_at, status, rating, recorded_by) VALUES
('test-plc-fixture-due', 'test-animal-fixture-due', 'test-adopter-fixture-due', 'adoption', strftime('%s','now','-35 days'), NULL, 'completed', 5, 'gatitosolivos@gmail.com');

-- A follow-up LINKED to the animal (the 0062 backfill is a no-op on the empty
-- CI database, so the linkage is seeded directly).
INSERT OR REPLACE INTO adopter_events (id, adopter_id, event_type, animal_id, placement_id, animal_name, species, rating, details, date, recorded_by) VALUES
('test-event-fixture-tl1', 'test-adopter-fixture-tl1', 'follow_up', 'test-animal-fixture-1', 'test-plc-fixture-1a', 'Timon', 'dog', 5, 'Muy bien adaptado a la casa nueva', strftime('%s','now','-50 days'), 'gatitosolivos@gmail.com');

-- A care event (vaccination) during the foster span.
INSERT OR REPLACE INTO animal_events (id, animal_id, event_type, date, details, recorded_by) VALUES
('test-aevent-fixture-tl1', 'test-animal-fixture-1', 'vaccination', strftime('%s','now','-100 days'), 'Quíntuple, primera dosis', 'gatitosolivos@gmail.com');

-- ── HEALTH RECORD FIXTURES (v2.56.123 — health-record.authed.spec.ts) ──
-- A photo ON the vaccination event (adopter_images.adoption_id is the EVENT
-- id for event photos), so the shared record has something for its lightbox.
INSERT OR REPLACE INTO adopter_images (id, adopter_id, adoption_id, url, caption, uploaded_at, added_by, is_profile_picture, is_primary, media_type) VALUES
('test-img-fixture-aevent1', 'test-adopter-fixture-tl1', 'test-aevent-fixture-tl1',
 'https://api.dicebear.com/7.x/shapes/svg?seed=carnet', 'Carnet de vacunación',
 strftime('%s','now','-100 days'), 'gatitosolivos@gmail.com', 0, 0, 'image');

-- A photo attached to the ADOPTION record rather than to the animal. The
-- adopter-side editor writes `adoption_id = <animal id>` with the ADOPTER's id
-- (AdoptionFormEditV2), so this row sits on the same key as the animal's own
-- gallery and can show the family. Its caption names the adopter on purpose:
-- the "carries no person" assertion greps the whole payload for that name, so
-- this row is what makes that assertion mean something.
INSERT OR REPLACE INTO adopter_images (id, adopter_id, adoption_id, url, caption, uploaded_at, added_by, is_profile_picture, is_primary, media_type, scope) VALUES
('test-img-fixture-adoption', 'test-adopter-fixture-tl1', 'test-animal-fixture-1',
 'https://api.dicebear.com/7.x/shapes/svg?seed=entrega', 'Fátima con Timon el día de la entrega',
 strftime('%s','now','-80 days'), 'gatitosolivos@gmail.com', 0, 0, 'image', 'placement');

-- The animal's own photos. Two of them, and the second is the point: it was
-- added from «Editar» on the animal page WHILE Timon was already adopted, so
-- it carries the holder's adopter_id exactly like the row above. Only `scope`
-- tells them apart, and this one is the animal's — it must reach both the
-- public listing and the family's health record.
INSERT OR REPLACE INTO adopter_images (id, adopter_id, adoption_id, url, caption, uploaded_at, added_by, is_profile_picture, is_primary, media_type, scope) VALUES
('test-img-fixture-listing', '__available__', 'test-animal-fixture-1',
 'https://api.dicebear.com/7.x/shapes/svg?seed=timon', 'Timon recién rescatado',
 strftime('%s','now','-119 days'), 'gatitosolivos@gmail.com', 0, 1, 'image', 'animal'),
('test-img-fixture-while-placed', 'test-adopter-fixture-tl1', 'test-animal-fixture-1',
 'https://api.dicebear.com/7.x/shapes/svg?seed=timon2', 'Timon un año después',
 strftime('%s','now','-10 days'), 'gatitosolivos@gmail.com', 0, 0, 'image', 'animal');

-- A RETURNED animal, back on the public listing. This is the case that makes
-- `scope` load-bearing: its adoption ended, so it is available again and the
-- showcase will serve it — and the photos it accumulated during that adoption
-- are the newest ones it has. The animal's own photo must come back with it;
-- the one attached to the adoption must not, whatever it shows.
INSERT OR REPLACE INTO adopters (id, name, contact_info, status, added_by, created_at, updated_at) VALUES
('test-adopter-fixture-ret', 'Devuelto Timeline', 'Tel: 555-0205', '5', 'test-seed', strftime('%s','now'), strftime('%s','now'));
UPDATE adopters SET country = 'AR' WHERE id = 'test-adopter-fixture-ret';

INSERT OR REPLACE INTO animals (id, name, species, details, sex, color, neutered, added_by, created_at, updated_at) VALUES
('test-animal-fixture-ret', 'Vuelta', 'cat', 'Fixture devuelta y re-publicada', 'hembra', 'naranja', 1, 'gatitosolivos@gmail.com', strftime('%s','now','-200 days'), strftime('%s','now'));

INSERT OR REPLACE INTO placements (id, animal_id, adopter_id, record_type, started_at, ended_at, status, rating, recorded_by) VALUES
('test-plc-fixture-ret', 'test-animal-fixture-ret', 'test-adopter-fixture-ret', 'adoption', strftime('%s','now','-150 days'), strftime('%s','now','-30 days'), 'completed', 3, 'gatitosolivos@gmail.com');

INSERT OR REPLACE INTO adopter_images (id, adopter_id, adoption_id, url, caption, uploaded_at, added_by, is_profile_picture, is_primary, media_type, scope) VALUES
('test-img-ret-animal', 'test-adopter-fixture-ret', 'test-animal-fixture-ret',
 'https://api.dicebear.com/7.x/shapes/svg?seed=vuelta', 'Vuelta en el sillón',
 strftime('%s','now','-60 days'), 'gatitosolivos@gmail.com', 0, 1, 'image', 'animal'),
('test-img-ret-placement', 'test-adopter-fixture-ret', 'test-animal-fixture-ret',
 'https://api.dicebear.com/7.x/shapes/svg?seed=entrega2', 'Devuelto Timeline firmando el contrato',
 strftime('%s','now','-150 days'), 'gatitosolivos@gmail.com', 0, 0, 'image', 'placement');

-- An animal whose ONLY animal_event is a `note`, and whose note names a foster
-- family. The shared record must 404 for it: `note` is unconstrained free text
-- the rescuer wrote for themselves, so it never reaches the adopting family.
-- Left AVAILABLE on purpose — the API gate is "has clinical events", not
-- custody, and an available animal keeps the adopted-by-year grouping intact.
INSERT OR REPLACE INTO animals (id, name, species, details, sex, color, neutered, added_by, created_at, updated_at) VALUES
('test-animal-fixture-note', 'Soloanota', 'dog', 'Fixture sin eventos clínicos', 'macho', 'negro', 0, 'gatitosolivos@gmail.com', strftime('%s','now','-30 days'), strftime('%s','now'));

INSERT OR REPLACE INTO animal_events (id, animal_id, event_type, date, details, recorded_by) VALUES
('test-aevent-fixture-note', 'test-animal-fixture-note', 'note', strftime('%s','now','-20 days'),
 'Lo retiró la familia de tránsito de Belgrano', 'gatitosolivos@gmail.com');

-- ============================================================
-- TEAM VISIBILITY FIXTURES (v2.55.18 — animal-timeline PR5)
-- The admin session shares an org with a teammate; the teammate's animal
-- must be visible (and actionable) to the admin, with attribution.
-- ============================================================

INSERT OR REPLACE INTO user (id, name, email, emailVerified, image) VALUES
('test-teammate-id', 'Vero E2E', 'e2e-teammate@example.com', strftime('%s','now'), NULL);

INSERT OR REPLACE INTO organizations (id, name, created_by, created_at, slug) VALUES
('test-org-fixture-1', 'Refugio E2E', 'gatitosolivos@gmail.com', strftime('%s','now'), 'refugio-e2e');

INSERT OR REPLACE INTO org_members (id, org_id, user_email, role, joined_at) VALUES
('test-orgm-fixture-1', 'test-org-fixture-1', 'gatitosolivos@gmail.com', 'owner', strftime('%s','now')),
('test-orgm-fixture-2', 'test-org-fixture-1', 'e2e-teammate@example.com', 'member', strftime('%s','now'));

-- An AVAILABLE animal owned by the teammate — appears in the admin's list.
INSERT OR REPLACE INTO animals (id, name, species, details, sex, color, neutered, added_by, created_at, updated_at) VALUES
('test-animal-fixture-2', 'Nube', 'cat', 'Gata fixture del equipo', 'hembra', 'blanca', 0, 'e2e-teammate@example.com', strftime('%s','now','-20 days'), strftime('%s','now'));

-- ============================================================
-- Owned-elsewhere fixtures (friendly-404). Owned by the teammate; the `user`
-- project (testuser@example.com, in no org) is NOT allowed to see them.
-- Read-only: no spec mutates these.
-- ============================================================
INSERT OR REPLACE INTO animals (id, name, species, details, sex, color, neutered, added_by, created_at, updated_at) VALUES
('test-animal-fixture-owned-1', 'Pirata', 'other', 'Fixture: ficha ajena sin publicar', NULL, NULL, 0, 'e2e-teammate@example.com', strftime('%s','now','-10 days'), strftime('%s','now')),
('test-animal-fixture-owned-2', 'Canela', 'dog', 'Fixture: ficha ajena publicada', 'hembra', 'canela', 1, 'e2e-teammate@example.com', strftime('%s','now','-10 days'), strftime('%s','now'));

INSERT OR REPLACE INTO adoptions (id, adopter_id, animal_name, species, details, status, record_type, date, added_by) VALUES
('test-animal-fixture-owned-2', NULL, 'Canela', 'dog', 'Fixture: ficha ajena publicada', 'completed', 'available', strftime('%s','now','-10 days'), 'e2e-teammate@example.com');

INSERT OR REPLACE INTO adopter_images (id, adopter_id, adoption_id, url, caption, uploaded_at, added_by, is_profile_picture, is_primary, media_type, scope) VALUES
('test-img-fixture-owned-2', '__available__', 'test-animal-fixture-owned-2', 'https://api.dicebear.com/7.x/shapes/svg?seed=canela', NULL, strftime('%s','now'), 'e2e-teammate@example.com', 0, 1, 'image', 'animal');

-- Shared-link fixtures (friendly-404 final review): a form submission and a
-- contract notification owned by the teammate. The admin (an org-mate) must see
-- the "no permission" screen on them, not the 404. Read-only.
INSERT OR REPLACE INTO form_submissions (id, user_id, name, status, created_at) VALUES
('test-formsub-fixture-teammate-1', 'e2e-teammate@example.com', 'Solicitante Fixture', 'pending', strftime('%s','now'));

INSERT OR REPLACE INTO notifications (id, user_id, type, title, body, url, icon, read, metadata, created_at) VALUES
('test-notif-fixture-teammate-1', 'e2e-teammate@example.com', 'contract_result', 'Fixture contrato', 'Fixture', '/contract-results/test-notif-fixture-teammate-1', '📋', 1, '{}', strftime('%s','now'));
