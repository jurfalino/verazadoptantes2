-- ==========================================================================
-- Showcase Seed: creates "test-adopter-showcase" — a single adopter record
-- that demonstrates EVERY attribute & flag on the search result card.
--
-- Run with:  npx wrangler d1 execute DB --local --file=tests/seed-showcase.sql
--
-- Prerequisites: run tests/seed.sql first (creates admin user, base config)
-- ==========================================================================

-- ──────────────────────────────────────────────────────────────
-- 1. ADOPTER PROFILE (name, contactInfo, addressInfo, familyMembers, dates)
-- ──────────────────────────────────────────────────────────────

INSERT OR REPLACE INTO adopters
    (id, name, contact_info, address_info, family_members, notes, status, added_by, country, created_at, updated_at)
VALUES (
    'test-adopter-showcase',
    'Valentina Showcase Pérez',
    'Tel: 11-5555-0001, Email: valentina.showcase@example.com, IG: @val_showcase',
    'Av. Corrientes 1234, Piso 3, CABA, Buenos Aires',
    'Ricardo Pérez (esposo), Tomás Pérez (hijo, 8 años)',
    'Registro de prueba para verificar todas las columnas y flags de la search card.',
    '4',
    'test-seed',
    'AR',
    strftime('%s', 'now', '-120 days'),
    strftime('%s', 'now', '-1 day')
);


-- ──────────────────────────────────────────────────────────────
-- 2. PROFILE IMAGE (provides the thumbnail)
-- ──────────────────────────────────────────────────────────────

INSERT OR REPLACE INTO adopter_images
    (id, adopter_id, url, caption, uploaded_at, added_by, is_profile_picture, media_type)
VALUES (
    'showcase-img-1',
    'test-adopter-showcase',
    'https://api.dicebear.com/7.x/notionists/svg?seed=valentina',
    'Profile picture (dicebear placeholder)',
    strftime('%s', 'now', '-60 days'),
    'test-seed',
    1,
    'image'
);


-- ──────────────────────────────────────────────────────────────
-- 3. ADOPTIONS  ≥5 within 90 days → triggers ⚠ tooManyAdoptions
--    (also provides avgRating and stats.adoptions count)
-- ──────────────────────────────────────────────────────────────

INSERT OR REPLACE INTO adoptions (id, adopter_id, animal_name, species, details, status, rating, record_type, date, added_by) VALUES
('showcase-adopt-1', 'test-adopter-showcase', 'Luna',     'dog', 'Mestiza mediana',          'completed', 5, 'adoption', strftime('%s','now','-80 days'), 'test-seed'),
('showcase-adopt-2', 'test-adopter-showcase', 'Michi',    'cat', 'Gatito atigrado 4 meses',  'completed', 4, 'adoption', strftime('%s','now','-60 days'), 'test-seed'),
('showcase-adopt-3', 'test-adopter-showcase', 'Rocky',    'dog', 'Cachorro golden retriever', 'completed', 5, 'adoption', strftime('%s','now','-40 days'), 'test-seed'),
('showcase-adopt-4', 'test-adopter-showcase', 'Nina',     'cat', 'Gata siamesa adulta',      'completed', 3, 'adoption', strftime('%s','now','-20 days'), 'test-seed'),
('showcase-adopt-5', 'test-adopter-showcase', 'Max',      'dog', 'Labrador 2 años',          'completed', 4, 'adoption', strftime('%s','now','-5 days'),  'test-seed');


-- ──────────────────────────────────────────────────────────────
-- 4. ADOPTION REQUESTS  ≥3 within 30 days → triggers ⚠ tooManyRequests
--    (also provides stats.requests count)
-- ──────────────────────────────────────────────────────────────

INSERT OR REPLACE INTO adoptions (id, adopter_id, animal_name, species, details, status, rating, record_type, date, added_by) VALUES
('showcase-req-1', 'test-adopter-showcase', 'Copito',   'dog', 'Solicitud pendiente',       'pending', NULL, 'adoption_request', strftime('%s','now','-25 days'), 'test-seed'),
('showcase-req-2', 'test-adopter-showcase', 'Pelusa',   'cat', 'Solicitud pendiente',       'pending', NULL, 'adoption_request', strftime('%s','now','-15 days'), 'test-seed'),
('showcase-req-3', 'test-adopter-showcase', 'Thor',     'dog', 'Solicitud pendiente',       'pending', NULL, 'adoption_request', strftime('%s','now','-3 days'),  'test-seed');


-- ──────────────────────────────────────────────────────────────
-- 5. STATS (search hits & profile views)
-- ──────────────────────────────────────────────────────────────

INSERT OR REPLACE INTO adopter_stats (id, adopter_id, event_type, user_id, created_at) VALUES
('showcase-stat-1',  'test-adopter-showcase', 'profile_view', 'viewer1@example.com', strftime('%s','now','-10 days')),
('showcase-stat-2',  'test-adopter-showcase', 'profile_view', 'viewer2@example.com', strftime('%s','now','-8 days')),
('showcase-stat-3',  'test-adopter-showcase', 'profile_view', 'viewer3@example.com', strftime('%s','now','-5 days')),
('showcase-stat-4',  'test-adopter-showcase', 'profile_view', 'viewer1@example.com', strftime('%s','now','-2 days')),
('showcase-stat-5',  'test-adopter-showcase', 'profile_view', 'viewer4@example.com', strftime('%s','now','-1 day')),
('showcase-stat-6',  'test-adopter-showcase', 'search_hit',   'searcher1@example.com', strftime('%s','now','-9 days')),
('showcase-stat-7',  'test-adopter-showcase', 'search_hit',   'searcher2@example.com', strftime('%s','now','-6 days')),
('showcase-stat-8',  'test-adopter-showcase', 'search_hit',   'searcher3@example.com', strftime('%s','now','-3 days'));


-- ──────────────────────────────────────────────────────────────
-- 6. FLAGS (manual)
--     • inaccurate  → ⚠ Inaccurate  (rose)
--     • duplicate   → 📄 Duplicate   (amber)
--     • verified_identity → ✓ Verified ID  (teal)
--     • verified_address  → ✓ Verified Addr (teal)
-- ──────────────────────────────────────────────────────────────

INSERT OR REPLACE INTO adopter_flags (id, adopter_id, flagged_by, reason, details, created_at) VALUES
('showcase-flag-inaccurate', 'test-adopter-showcase', 'test-seed', 'inaccurate',       'Nombre reportado como incorrecto',  strftime('%s','now','-30 days')),
('showcase-flag-duplicate',  'test-adopter-showcase', 'test-seed', 'duplicate',        'Posible duplicado con otro perfil', strftime('%s','now','-25 days')),
('showcase-flag-ver-id',     'test-adopter-showcase', 'test-seed', 'verified_identity', 'DNI verificado en persona',         strftime('%s','now','-20 days')),
('showcase-flag-ver-addr',   'test-adopter-showcase', 'test-seed', 'verified_address',  'Dirección confirmada por visita',   strftime('%s','now','-18 days'));


-- ──────────────────────────────────────────────────────────────
-- 7. SYSTEM DUPLICATE (medium+ confidence, pending)
--     → 🔗 Possible duplicate  (stone)
--     Note: won't show when manual duplicate flag is also present
--           (card logic: `systemDuplicate && !duplicate`).
--           Keeping here for completeness; remove flag-duplicate
--           row above to see the systemDuplicate badge instead.
-- ──────────────────────────────────────────────────────────────

INSERT OR REPLACE INTO duplicate_candidates
    (id, adopter1_id, adopter2_id, match_types, match_values, score, confidence, status, detected_at)
VALUES (
    'showcase-dup-candidate',
    'test-adopter-showcase',
    'test-adopter-1',
    '["phone","name_word"]',
    '{"phone":"55550001","name_word":["perez"]}',
    4,
    'medium',
    'pending',
    strftime('%s','now','-7 days')
);


-- ──────────────────────────────────────────────────────────────
-- 8. HISTORY LOG (enables matchContext = "match_history")
--    Search for "Valentina Prueba" to see the teal match badge.
-- ──────────────────────────────────────────────────────────────

INSERT OR REPLACE INTO adopter_history
    (id, adopter_id, changed_by, changes, changed_at)
VALUES (
    'showcase-history-1',
    'test-adopter-showcase',
    'test-seed',
    '{"name":{"old":"Valentina Prueba Pérez","new":"Valentina Showcase Pérez"}}',
    strftime('%s','now','-15 days')
);
