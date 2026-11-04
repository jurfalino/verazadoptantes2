#!/usr/bin/env node
/**
 * Mobile screenshots of the product for the /funcionalidades marketing page.
 *
 * What it does, in one run:
 *   1. Backs up the two tracked local databases (local.db and the .wrangler D1
 *      sqlite that `next dev` actually reads) byte-for-byte to a temp folder.
 *   2. Builds a FRESH database from drizzle/*.sql (no e2e seed rows), heals any
 *      column a migration order quirk leaves out (checked against
 *      src/db/schema.ts), and seeds a fictional showcase dataset: rescuers, a
 *      team, adopters named Juan, animals, placements, notifications. Search
 *      tokens come from the app's own tokenizer (src/lib/tokenizer.ts).
 *   3. Starts its own `next dev` on port 3102 (never 3000), submits one
 *      adoption form through the real public API, and captures each screen
 *      with Playwright Chromium at 390x844 @2x, Spanish, light theme.
 *   4. Always (even on failure) stops the server and restores both databases
 *      from the backup.
 *
 * Re-run:
 *   export PATH=/opt/homebrew/opt/node@20/bin:$PATH   # Node 20 (better-sqlite3)
 *   node scripts/capture-feature-screenshots.mjs
 *
 * Options:
 *   --only search,profile      capture a subset
 *   --photos <dir>             jpg/png/webp animal photos for /my-animals
 *                              (assigned in file-name order to the available
 *                              animals; without it the app's placeholders show)
 *   --keep-db                  leave the showcase DB in place (no restore)
 *   --port 3102                dev-server port
 *
 * Needs AUTH_SECRET in .env.local (copied, never symlinked; gitignored) to sign
 * session cookies the same way tests/auth.setup.ts does.
 * Output: public/images/features/shots/<name>.png
 * All people, phones (+54 11 5555-xxxx) and emails (@example.com) are fictional.
 */

import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argVal = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const PORT = Number(argVal('--port') || 3102);
const BASE = `http://localhost:${PORT}`;
const ONLY = argVal('--only') ? new Set(argVal('--only').split(',')) : null;
const PHOTOS_DIR = argVal('--photos');
const KEEP_DB = args.includes('--keep-db');
const SERVE = args.includes('--serve'); // debug: seed + start the server, skip capture, wait for Ctrl-C
const OUT_DIR = path.join(ROOT, 'public/images/features/shots');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'feature-shots-'));

dotenv.config({ path: path.join(ROOT, '.env.local') });
const AUTH_SECRET = process.env.AUTH_SECRET;

const jiti = createJiti(import.meta.url, { alias: { '@': path.join(ROOT, 'src') } });
const log = (...m) => console.log('[shots]', ...m);

// ─── Databases ────────────────────────────────────────────────────────────────

const LOCAL_DB = path.join(ROOT, 'local.db');
const WRANGLER_DIR = path.join(ROOT, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
function wranglerDbPath() {
    if (!fs.existsSync(WRANGLER_DIR)) throw new Error(`No local D1 at ${WRANGLER_DIR} — run \`npx wrangler d1 execute DB --local --command "SELECT 1"\` once first.`);
    const f = fs.readdirSync(WRANGLER_DIR).find(n => n.endsWith('.sqlite'));
    if (!f) throw new Error(`No .sqlite file in ${WRANGLER_DIR}`);
    return path.join(WRANGLER_DIR, f);
}
const SIDE = ['-wal', '-shm', '-journal'];
const removeSidecars = (p) => SIDE.forEach(s => fs.rmSync(p + s, { force: true }));

function statementsFrom(file) {
    return fs.readFileSync(file, 'utf8').replace(/^\s*--.*$/gm, '')
        .split(';').map(s => s.trim()).filter(Boolean);
}

function applyMigrations(db) {
    const files = fs.readdirSync(path.join(ROOT, 'drizzle')).filter(f => f.endsWith('.sql')).sort();
    const failed = [];
    for (const f of files) {
        for (const stmt of statementsFrom(path.join(ROOT, 'drizzle', f))) {
            try { db.exec(stmt); } catch (e) {
                const msg = String(e.message || e);
                if (!/already exists|duplicate column|UNIQUE constraint/i.test(msg)) failed.push(`${f}: ${msg}`);
            }
        }
    }
    return failed;
}

/** Columns in src/db/schema.ts that the migration replay left out. */
async function schemaDrift(db, schema) {
    const { getTableConfig } = await import('drizzle-orm/sqlite-core');
    const { is, Table } = await import('drizzle-orm');
    const missing = [];
    for (const t of Object.values(schema)) {
        if (!is(t, Table)) continue;
        const cfg = getTableConfig(t);
        const info = db.prepare(`PRAGMA table_info(${cfg.name})`).all();
        if (!info.length) { missing.push({ table: cfg.name, column: null }); continue; }
        const have = new Set(info.map(r => r.name));
        for (const c of cfg.columns) if (!have.has(c.name)) missing.push({ table: cfg.name, column: c.name, type: c.getSQLType() });
    }
    return missing;
}

async function buildFreshDb(file, schema, metadataSource) {
    fs.rmSync(file, { force: true });
    const db = new Database(file);
    applyMigrations(db);
    let drift = await schemaDrift(db, schema);
    for (const d of drift) {
        if (d.column) db.exec(`ALTER TABLE ${d.table} ADD COLUMN ${d.column} ${d.type}`);
    }
    // Second pass: statements that needed the healed columns (0074's backfill + index).
    const failed = applyMigrations(db).filter(m => !/no such table: (adoption_images)/.test(m));
    drift = await schemaDrift(db, schema);
    if (drift.length) throw new Error(`Schema still drifts after healing: ${JSON.stringify(drift)}`);
    if (failed.length) log('migration statements that did not apply (ok if only legacy data fixes):', failed.length);
    // Miniflare's own bookkeeping table, copied from the original file.
    try {
        const src = new Database(metadataSource, { readonly: true });
        const rows = src.prepare('SELECT key, value FROM _cf_METADATA').all();
        src.close();
        db.exec('CREATE TABLE IF NOT EXISTS _cf_METADATA (key INTEGER PRIMARY KEY, value BLOB)');
        const ins = db.prepare('INSERT OR REPLACE INTO _cf_METADATA (key, value) VALUES (?, ?)');
        for (const r of rows) ins.run(r.key, r.value);
    } catch (e) { log('note: _cf_METADATA not copied:', e.message); }
    return db;
}

// ─── Showcase data ────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const ago = (days, hours = 0) => new Date(Date.now() - days * DAY - hours * 3_600_000);

const P = 'showcase-';
const U = {
    lucia: { id: `${P}user-lucia`, name: 'Lucía Fernández', email: 'lucia.fernandez@example.com', handle: 'lucia-fernandez' },
    martin: { id: `${P}user-martin`, name: 'Martín Gómez', email: 'martin.gomez@example.com', handle: 'martin-gomez' },
    carla: { id: `${P}user-carla`, name: 'Carla Ruiz', email: 'carla.ruiz@example.com', handle: 'carla-ruiz' },
    sofia: { id: `${P}user-sofia`, name: 'Sofía Benítez', email: 'sofia.benitez@example.com', handle: 'sofia-benitez' },
    ana: { id: `${P}user-ana`, name: 'Ana Villalba', email: 'ana.villalba@example.com', handle: 'ana-villalba' },
    rocio: { id: `${P}user-rocio`, name: 'Rocío Medina', email: 'rocio.medina@example.com', handle: 'rocio-medina' },
    diego: { id: `${P}user-diego`, name: 'Diego Castro', email: 'diego.castro@example.com', handle: 'diego-castro' },
};
const ORG = { id: `${P}org-patitas`, name: 'Refugio Patitas', slug: 'refugio-patitas' };
const ADOPTER = {
    perez: `${P}adopter-juan-perez`,
    gimenez: `${P}adopter-juan-gimenez`,
    sosa: `${P}adopter-juan-sosa`,
    martina: `${P}adopter-martina-acosta`,
    carolina: `${P}adopter-carolina-paz`,
};
const CONTRACT_NOTIF = `${P}notif-contract-simon`;

async function seed(sqlite, mods) {
    const { schema: s, drizzle, tokenizer, contactEntries: ce } = mods;
    const db = drizzle(sqlite, { schema: s });

    await db.insert(s.appConfig).values([
        ['ENABLE_PII_ACCESS_GATING', 'true'],
        ['ENABLE_CUSTOM_ADOPTION_DOCS', 'true'],
        ['ENABLE_ANIMALS_FOR_ADOPTION', 'true'],
        ['ENABLE_FOLLOWUPS', 'true'],
        ['ENABLE_GUIDED_WALKTHROUGH', 'false'],
        ['ENABLE_PENDING_SEARCHES', 'false'],
        ['ENABLE_PWA_INSTALL_PROMPT', 'false'],
        ['ENABLE_CHAT_WIDGET', 'false'],
        ['too_many_adoptions_threshold', '5'],
        ['too_many_adoptions_period_days', '90'],
        ['too_many_requests_threshold', '3'],
        ['too_many_requests_period_days', '30'],
    ].map(([key, value]) => ({ key, value, updatedAt: new Date(), updatedBy: U.lucia.email })))
        .onConflictDoUpdate({ target: s.appConfig.key, set: { value: sqlRef(mods, 'excluded.value') } });

    // Rescuers
    for (const u of Object.values(U)) {
        await db.insert(s.users).values({ id: u.id, name: u.name, email: u.email, googleName: u.name, emailVerified: ago(200) });
        await db.insert(s.userProfiles).values({
            userId: u.id, role: 'viewer', country: 'AR', countryConfirmed: 1, province: 'Buenos Aires',
            city: 'Buenos Aires', timezone: 'America/Argentina/Buenos_Aires', termsAcceptedAt: ago(180), termsVersion: 1,
            handle: u.handle, createdAt: ago(200), lastActiveAt: ago(0),
        });
    }

    // Team
    await db.insert(s.organizations).values({ ...ORG, createdBy: U.lucia.email, createdAt: ago(320) });
    const members = [[U.lucia, 'owner', 320], [U.martin, 'admin', 300], [U.carla, 'member', 140], [U.sofia, 'member', 2]];
    for (const [u, role, d] of members) {
        await db.insert(s.orgMembers).values({ id: `${P}member-${u.handle}`, orgId: ORG.id, userEmail: u.email, role, joinedAt: ago(d) });
    }

    // Adopters ---------------------------------------------------------------
    const adopterRows = [];
    const addAdopter = async ({ id, name, owner, phone, email, social, dni, address, notes, created, source = 'manual', household }) => {
        const entries = ce.buildContactEntries({
            ids: dni ? [{ value: dni, label: 'DNI' }] : [],
            phones: phone ? [{ value: phone, apps: ['whatsapp'] }] : [],
            emails: email ? [email] : [],
            socials: social ? [social] : [],
            addresses: address ? [address] : [],
        }).map(e => ({ ...e, addedBy: owner.email }));
        const row = {
            id, name, contactEntries: JSON.stringify(entries), contactInfo: ce.contactEntriesToBlob(entries),
            addressInfo: address || null, householdMembers: household ? JSON.stringify(household) : null,
            notes: notes || null, addedBy: owner.email, country: 'AR', source, status: '5',
            createdAt: created, updatedAt: created,
        };
        await db.insert(s.adopters).values(row);
        await db.insert(s.adopterHistory).values({
            id: `${P}history-${id}`, adopterId: id, changedBy: owner.email,
            changes: JSON.stringify({ name: { from: null, to: name } }), changedAt: created,
        });
        adopterRows.push({ row, entries });
    };

    await addAdopter({
        id: ADOPTER.perez, name: 'Juan Pérez', owner: U.lucia, created: ago(730),
        phone: '+54 11 5555-1234', email: 'juan.perez@example.com', social: 'https://instagram.com/juanperez.hogar',
        address: 'Av. Corrientes 4321, Almagro, CABA', dni: '30.456.789',
    });
    await addAdopter({
        id: ADOPTER.gimenez, name: 'Juan Carlos Giménez', owner: U.ana, created: ago(70),
        phone: '+54 11 5555-8812', email: 'jcgimenez@example.com', address: 'Calle 12 1450, La Plata, Buenos Aires',
    });
    await addAdopter({
        id: ADOPTER.sosa, name: 'Juan Manuel Sosa', owner: U.rocio, created: ago(240),
        phone: '+54 11 5555-3907', social: 'https://facebook.com/juanmanuel.sosa.77', address: 'Av. Mitre 980, Avellaneda, Buenos Aires',
    });
    await addAdopter({
        id: ADOPTER.martina, name: 'Martina Acosta', owner: U.lucia, created: ago(0, 3), source: 'contract',
        phone: '+54 11 5555-6620', email: 'martina.acosta@example.com', dni: '38.112.450', address: 'Gascón 760, Palermo, CABA',
    });
    await addAdopter({
        id: ADOPTER.carolina, name: 'Carolina Paz', owner: U.lucia, created: ago(400),
        phone: '+54 11 5555-7311', email: 'carolina.paz@example.com', address: 'Bulnes 1550, Palermo, CABA',
    });

    await db.insert(s.adopterFlags).values([
        { id: `${P}flag-perez-identity`, adopterId: ADOPTER.perez, flaggedBy: U.lucia.email, reason: 'verified_identity', details: 'DNI verificado en la entrega', createdAt: ago(700) },
        { id: `${P}flag-perez-address`, adopterId: ADOPTER.perez, flaggedBy: U.ana.email, reason: 'verified_address', details: 'Visita al domicilio', createdAt: ago(360) },
    ]);

    // Animals + placements -----------------------------------------------------
    const animal = async (a) => {
        await db.insert(s.animals).values({
            id: a.id, name: a.name, species: a.species, sex: a.sex, color: a.color, details: a.details || null,
            neutered: a.neutered ? 1 : 0, estimatedBirthDate: a.born, addedBy: a.owner.email,
            listed: a.listed === false ? 0 : null, createdAt: a.created, updatedAt: a.created,
        });
        if (a.placement) {
            const pl = a.placement;
            await db.insert(s.placements).values({
                id: `${P}placement-${a.id.replace(P, '')}`, animalId: a.id, adopterId: pl.adopterId, recordType: pl.type || 'adoption',
                startedAt: pl.date, rating: pl.rating ?? null, status: 'active', comments: pl.comment || null,
                deliveredToHome: pl.delivered ? 1 : 0, identityVerified: pl.verified ? 1 : 0,
                recordedBy: pl.by?.email || a.owner.email, createdAt: pl.date,
            });
        }
    };

    // Juan Pérez: three well-rated adoptions over two years.
    await animal({ id: `${P}animal-felipe`, name: 'Felipe', species: 'dog', sex: 'macho', color: 'Negro y fuego', neutered: true, born: ago(400), owner: U.lucia, created: ago(60),
        details: 'Mestizo mediano, muy compañero.', placement: { adopterId: ADOPTER.perez, date: ago(9), rating: 5, delivered: true, verified: true, comment: 'Entrega en el domicilio, todo en orden.' } });
    await animal({ id: `${P}animal-olivia`, name: 'Olivia', species: 'cat', sex: 'hembra', color: 'Carey', neutered: true, born: ago(900), owner: U.ana, created: ago(420),
        placement: { adopterId: ADOPTER.perez, date: ago(365), rating: 5, delivered: true } });
    await animal({ id: `${P}animal-coco`, name: 'Coco', species: 'cat', sex: 'macho', color: 'Naranja', neutered: true, born: ago(1300), owner: U.rocio, created: ago(760),
        placement: { adopterId: ADOPTER.perez, date: ago(720), rating: 4 } });

    // Juan Carlos Giménez: five adoptions from five rescues in 16 days.
    const gim = [['Rayo', 'dog', 'macho', U.ana, 52], ['Nube', 'cat', 'hembra', U.rocio, 48], ['Tango', 'dog', 'macho', U.martin, 44], ['Mía', 'cat', 'hembra', U.carla, 40], ['Lola', 'dog', 'hembra', U.diego, 36]];
    for (const [name, species, sex, owner, d] of gim) {
        await animal({ id: `${P}animal-${name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')}`, name, species, sex, color: species === 'cat' ? 'Atigrado' : 'Marrón', born: ago(500), owner, created: ago(d + 30),
            placement: { adopterId: ADOPTER.gimenez, date: ago(d), rating: d === 44 ? 4 : 3 } });
    }

    // Lucía's current animals.
    await animal({ id: `${P}animal-mora`, name: 'Mora', species: 'cat', sex: 'hembra', color: 'Negra', neutered: true, born: ago(700), owner: U.lucia, created: ago(35), details: 'Tranquila, ideal para departamento.' });
    await animal({ id: `${P}animal-toto`, name: 'Toto', species: 'dog', sex: 'macho', color: 'Blanco con manchas', neutered: false, born: ago(120), owner: U.lucia, created: ago(20), details: 'Cachorro juguetón, se lleva bien con gatos.' });
    await animal({ id: `${P}animal-luna`, name: 'Luna', species: 'cat', sex: 'hembra', color: 'Gris', neutered: true, born: ago(260), owner: U.lucia, created: ago(50),
        placement: { adopterId: ADOPTER.carolina, type: 'foster', date: ago(25) } });
    await animal({ id: `${P}animal-pipa`, name: 'Pipa', species: 'dog', sex: 'hembra', color: 'Caramelo', neutered: true, born: ago(1500), owner: U.martin, created: ago(15), details: 'Adulta, muy dulce, camina bien con correa.' });
    // Simón: adopted today through the signed contract.
    await animal({ id: `${P}animal-simon`, name: 'Simón', species: 'cat', sex: 'macho', color: 'Blanco y gris', neutered: true, born: ago(330), owner: U.lucia, created: ago(45),
        placement: { adopterId: ADOPTER.martina, date: ago(0, 3) } });
    await db.insert(s.signedContracts).values({ id: `${P}signed-simon`, animalId: `${P}animal-simon`, adopterId: ADOPTER.martina, via: 'open', locale: 'es', signedAt: Math.floor(ago(0, 3).getTime() / 1000) });

    // Photos for the available animals (optional --photos).
    if (PHOTOS_DIR) {
        const sharp = (await import('sharp')).default;
        const files = fs.readdirSync(PHOTOS_DIR).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).sort();
        const targets = [`${P}animal-mora`, `${P}animal-toto`, `${P}animal-luna`, `${P}animal-pipa`];
        for (let i = 0; i < Math.min(files.length, targets.length); i++) {
            const buf = await sharp(path.join(PHOTOS_DIR, files[i])).rotate().resize(640, 640, { fit: 'cover' }).jpeg({ quality: 78 }).toBuffer();
            await db.insert(s.adopterImages).values({
                id: `${P}photo-${i}`, adopterId: '__available__', adoptionId: targets[i], url: `data:image/jpeg;base64,${buf.toString('base64')}`,
                scope: 'animal', isPrimary: 1, addedBy: U.lucia.email, uploadedAt: ago(10), mediaType: 'image',
            });
        }
        log(`photos: ${Math.min(files.length, targets.length)} assigned from ${PHOTOS_DIR}`);
    }

    // Adopter-side events -----------------------------------------------------
    const ev = (id, adopterId, eventType, by, date, extra = {}) => db.insert(s.adopterEvents).values({
        id: `${P}event-${id}`, adopterId, eventType, recordedBy: by.email, date, createdAt: date, ...extra,
    });
    await ev('perez-obs', ADOPTER.perez, 'observation', U.rocio, ago(300), { rating: 5, animalName: 'Coco', species: 'cat', details: 'Excelente adoptante: manda fotos seguido y cumplió con todas las vacunas.' });
    await ev('perez-followup', ADOPTER.perez, 'follow_up', U.ana, ago(330), { rating: 5, animalId: `${P}animal-olivia`, placementId: `${P}placement-animal-olivia`, animalName: 'Olivia', followupSubtype: 'adaptation', details: 'Olivia está adaptada, duerme adentro y ya está castrada.' });
    await ev('sosa-returned', ADOPTER.sosa, 'returned_pet', U.rocio, ago(150), { rating: 1, animalName: 'Kiara', species: 'cat', details: 'Devolvió a la gata a las tres semanas; la tenía en el balcón sin red.' });
    await ev('sosa-obs', ADOPTER.sosa, 'observation', U.ana, ago(60), { rating: 2, animalName: 'Kiara', species: 'cat', details: 'No respondió a los seguimientos y no permitió la visita.' });
    await ev('sosa-request', ADOPTER.sosa, 'adoption_request', U.martin, ago(5), { species: 'dog', details: 'Pidió un cachorro por Instagram.' });
    await db.insert(s.adopterFlags).values({ id: `${P}flag-sosa-inaccurate`, adopterId: ADOPTER.sosa, flaggedBy: U.ana.email, reason: 'inaccurate_information', details: 'La dirección no coincide con la que dio en la entrevista.', createdAt: ago(58) });

    // Search tokens — exactly what tokenizeAdopter() writes (src/lib/adopterTokenize.ts).
    for (const { row, entries } of adopterRows) {
        const household = mods.householdMembers.deserializeHouseholdMembers(row.householdMembers).map(m => ({ name: m.name, contactEntries: m.contactEntries }));
        const tokens = tokenizer.extractTokens(row, [], ce.deserializeContactEntries(row.contactEntries) || entries, household);
        let n = 0;
        for (const t of tokens) {
            await db.insert(s.duplicateTokens).values({ id: `${P}token-${row.id.replace(P, '')}-${n++}`, adopterId: row.id, tokenType: t.type, tokenValue: t.value });
        }
        await db.update(s.adopters).set({ tokenHash: tokenizer.computeTokenHash(row) }).where(mods.eq(s.adopters.id, row.id));
    }

    // Notifications for Lucía (the form one is created by the real API at run time).
    const followCopy = mods.followupCopy;
    await db.insert(s.notifications).values([
        {
            id: CONTRACT_NOTIF, userId: U.lucia.email, type: 'contract_result', icon: '✅', read: 0,
            title: 'Simón adoptado por Martina Acosta',
            body: 'No se encontraron registros previos para Martina Acosta. Todo en orden.',
            url: `/contract-results/${CONTRACT_NOTIF}`, createdAt: ago(0, 3),
            metadata: JSON.stringify({
                notificationId: CONTRACT_NOTIF, animalId: `${P}animal-simon`, animalName: 'Simón', adopterId: ADOPTER.martina,
                adopterName: 'Martina Acosta', matchCount: 0,
                submittedData: { name: 'Martina Acosta', phone: '+54 11 5555-6620', email: 'martina.acosta@example.com', dni: '38.112.450', address: 'Gascón 760, Palermo, CABA', socialNetworks: '@martina.acosta' },
            }),
        },
        {
            id: `${P}notif-followup-felipe`, userId: U.lucia.email, type: 'follow_up_due', icon: '🔔', read: 0,
            title: followCopy.notificationTitle('Felipe'),
            body: followCopy.notificationBody({ copyKey: 'checkin_7d', offsetDays: 7 }, 'Juan Pérez', false),
            url: `/my-animals/${P}animal-felipe#next-action`, createdAt: ago(1, 2),
            metadata: JSON.stringify({ animalId: `${P}animal-felipe`, placementId: `${P}placement-animal-felipe`, followupKey: 'checkin_7d' }),
        },
        {
            id: `${P}notif-access-martina`, userId: U.lucia.email, type: 'pii_access_request', icon: '🔒', read: 1,
            title: 'Solicitud de acceso a contacto',
            body: 'Martín Gómez solicitó acceso a los datos de contacto de Juan Manuel Sosa.',
            url: `/adopter/${ADOPTER.sosa}`, createdAt: ago(1, 20),
            metadata: JSON.stringify({ adopterId: ADOPTER.sosa }),
        },
        {
            id: `${P}notif-member-sofia`, userId: U.lucia.email, type: 'member_joined', icon: '👋', read: 1,
            title: '👋 Nuevo miembro', body: `${U.sofia.name} se unió a ${ORG.name}.`, url: '/organizations', createdAt: ago(2, 4),
        },
    ]);
}

function sqlRef(mods, raw) { return mods.sql.raw(raw); }

// ─── Server ───────────────────────────────────────────────────────────────────

function portBusy(port) {
    try { return execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: 'utf8' }).trim().length > 0; } catch { return false; }
}

async function startServer() {
    if (portBusy(PORT)) throw new Error(`Port ${PORT} is already in use — stop that server first.`);
    const logFile = path.join(WORK, 'next-dev.log');
    const out = fs.openSync(logFile, 'a');
    const child = spawn('npx', ['next', 'dev', '-p', String(PORT)], {
        cwd: ROOT, detached: true, stdio: ['ignore', out, out],
        env: {
            ...process.env, PORT: String(PORT), AUTH_URL: BASE, NEXTAUTH_URL: BASE, RESEND_API_KEY: '',
            NODE_OPTIONS: '--max-old-space-size=4096 --expose-gc', NEXT_TELEMETRY_DISABLED: '1',
        },
    });
    cleanup.child = child; // a Ctrl-C during the long boot must still kill it
    log(`next dev starting on ${PORT} (log: ${logFile})`);
    const deadline = Date.now() + 240_000;
    while (Date.now() < deadline) {
        try { const r = await fetch(`${BASE}/api/ready`); if (r.ok) { log('server ready'); return { child, logFile }; } } catch { /* not yet */ }
        await new Promise(r => setTimeout(r, 2000));
    }
    throw new Error(`Server did not become ready; see ${logFile}`);
}

async function stopServer(child) {
    if (!child) return;
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* gone */ }
    for (let i = 0; i < 20 && portBusy(PORT); i++) await new Promise(r => setTimeout(r, 500));
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ }
    await new Promise(r => setTimeout(r, 1000));
}

// ─── Capture ──────────────────────────────────────────────────────────────────

async function sessionCookie(user) {
    const { encode } = await import('next-auth/jwt');
    const value = await encode({
        secret: AUTH_SECRET, salt: 'authjs.session-token',
        token: { email: user.email, name: user.name, sub: user.id, sessionVersion: 3 },
    });
    return { name: 'authjs.session-token', value, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' };
}

async function newContext(browser, user) {
    const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
        locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires', colorScheme: 'light',
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });
    await ctx.addCookies([await sessionCookie(user)]);
    await ctx.addInitScript((email) => {
        try {
            const set = (k, v) => localStorage.setItem(k, v);
            set('app-locale', 'es'); set('theme', 'light'); set('playwright_test_mode', '1'); set('disclaimerAcknowledged', 'true');
            set(`country_confirmed_${email}`, '1');
            ['social_proof_dismissed', 'referral_banner_dismissed', 'pwa-install-dismissed', 'org-banner-dismissed'].forEach(k => set(k, '1'));
        } catch { /* storage blocked */ }
    }, user.email);
    return ctx;
}

const HIDE_CSS = `
  nextjs-portal, [data-nextjs-toast], #__next-build-watcher, [data-next-badge-root] { display: none !important; }
  *, *::before, *::after { caret-color: transparent !important; }
`;

async function settle(page) {
    await page.waitForLoadState('domcontentloaded');
    await page.waitForLoadState('load').catch(() => {});
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
        const busy = await page.evaluate(() => {
            const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
            return [...document.querySelectorAll('.animate-pulse, .animate-spin, [aria-busy="true"]')].filter(visible).length;
        }).catch(() => 1);
        if (!busy) break;
        await page.waitForTimeout(400);
    }
    await page.waitForTimeout(900);
}

async function prepare(page, keepOpen = false) {
    // A dev error overlay means the page is broken — never hide it silently.
    const overlay = await page.locator('nextjs-portal [data-nextjs-dialog], nextjs-portal [data-nextjs-dialog-overlay]').count().catch(() => 0);
    if (overlay) throw new Error(`Next.js error overlay on ${page.url()}`);
    await page.addStyleTag({ content: HIDE_CSS });
    // Accept the T&C modal if it ever shows (profiles are seeded as accepted).
    const terms = page.locator('input[type="checkbox"][aria-required="true"]');
    if (await terms.isVisible().catch(() => false)) {
        await terms.check();
        await page.getByRole('button', { name: /Aceptar y continuar/i }).click().catch(() => {});
        await page.waitForTimeout(600);
    }
    if (keepOpen) return;
    await page.keyboard.press('Escape').catch(() => {});
    await page.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur());
}

const warnings = [];
async function checkText(page, name) {
    const text = await page.evaluate(() => document.body.innerText);
    const probs = [];
    if (/\b(test|fixture|demo)\b/i.test(text)) probs.push(`contains ${text.match(/\b(test|fixture|demo)\b/i)[0]}`);
    if (text.includes('\\n')) probs.push('literal \\n');
    const rawKey = text.match(/\b(petshield|formResults|dashboard|common|nav|adopter|settings|organizations|notifications|myAnimals|adoptionDocs|search)\.[a-zA-Z_.]+\b/);
    if (rawKey) probs.push(`raw i18n key ${rawKey[0]}`);
    if (probs.length) { warnings.push(`${name}: ${probs.join('; ')}`); log(`WARN ${name}: ${probs.join('; ')}`); }
}

/** Scroll so `locator` sits just under the sticky h-16 nav. */
async function scrollUnderNav(page, locator, offset = 76) {
    await locator.first().scrollIntoViewIfNeeded();
    await page.evaluate(([y]) => {
        window.scrollBy(0, -y);
    }, [offset]);
    await page.evaluate(() => 0);
    const box = await locator.first().boundingBox();
    if (box) await page.evaluate(([top, off]) => window.scrollBy(0, top - off), [box.y, offset]);
    await page.waitForTimeout(500);
}

async function shoot(page, name, clip, { keepOpen = false } = {}) {
    await prepare(page, keepOpen);
    await checkText(page, name);
    const file = path.join(OUT_DIR, `${name}.png`);
    await page.screenshot({ path: file, ...(clip ? { clip, fullPage: true } : {}) });
    log(`captured ${name}`);
    return file;
}

async function submitForm() {
    // The real public form endpoint (contract-app posts the same body): creates
    // the submission, the applicant's profile, its search tokens and Lucía's
    // notification exactly as production does.
    const body = {
        name: 'Valentina Ríos', email: 'valentina.rios@example.com', phone: '+54 11 5555-4821',
        address: 'Av. Rivadavia 5120, Caballito, CABA', animalId: `${P}animal-mora`,
        intent: 'self', species: 'cat', lifeStage: 'young', ageRange: '26-35', carer: 'me',
        householdPeople: [
            { relationship: 'partner', age: 34, firstName: 'Tomás', lastName: 'Ibarra' },
            { relationship: 'child', age: 7, firstName: 'Emma', lastName: 'Ibarra' },
        ],
        allergy: 'no', existingPets: { cats: 1 }, petsCare: 'yes',
        housingType: 'apartment', rental: 'rentUnsure', hasOutdoor: 'yes', isSafe: 'no', catOutdoor: 'sometimes', sleepPlace: 'inside',
        hoursAlone: '6-8', lastAnimal: 'lost', petExperience: 'cat', gaveAway: 'no',
        instagram: '@valen.rios', vetReference: 'Veterinaria San Roque, Caballito',
        motivation: 'Perdimos a nuestro gato el año pasado y queremos darle un hogar a Mora. Trabajo desde casa tres días.',
        howHeard: 'Instagram del refugio',
        willingToSterilize: 'yes', sterilizeHow: 'done', vetCommitment: true, specialNeeds: false,
        movingIfNoPets: 'find', vacationPlan: 'family', returnReasons: 'no', adaptPlan: 'askRescue', visitConsent: 'yes',
        geo: 'yes', legal: true,
    };
    const res = await fetch(`${BASE}/api/form/${U.lucia.id}/submit`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.submissionId) throw new Error(`form submit failed: ${res.status} ${JSON.stringify(json)}`);
    log(`form submitted: ${json.submissionId}`);
    return json.submissionId;
}

async function capture(submissionId) {
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch();
    const files = [];
    try {
        const owner = await newContext(browser, U.lucia);
        const other = await newContext(browser, U.diego);
        const page = await owner.newPage();
        const want = (n) => !ONLY || ONLY.has(n);
        const go = async (p, url) => { await p.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded', timeout: 180_000 }); await settle(p); };

        // Warm the routes once: the first dev compile of each is slow.
        for (const url of ['/', `/adopter/${ADOPTER.perez}`, '/my-animals', '/notificaciones', '/organizations']) {
            await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded', timeout: 180_000 }).catch(() => {});
        }

        if (want('search')) {
            await go(page, '/');
            await page.fill('input#search', 'Juan');
            await page.getByRole('button', { name: /buscar registros|search records/i }).click();
            await page.locator('a[href*="/adopter/"]').first().waitFor({ timeout: 60_000 });
            await settle(page);
            const ids = await page.locator('a[href*="/adopter/"]').evaluateAll(as => [...new Set(as.map(a => a.getAttribute('href').split('/adopter/')[1].split(/[?#]/)[0]))]);
            if (ids.length !== 3) warnings.push(`search: expected 3 adopters, got ${ids.length} (${ids.join(', ')})`);
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.waitForTimeout(300);
            // From the search card's heading («Buscá referencias…») down to the third result.
            const heading = page.getByText(/Buscá referencias/).first();
            const top = (await heading.count())
                ? await heading.evaluate(el => el.getBoundingClientRect().top + window.scrollY - 36)
                : await page.locator('input#search').evaluate(el => el.getBoundingClientRect().top + window.scrollY - 80);
            // One screen tall, like every other shot: the page declares 780x1688
            // for all of them and only shows the top of each phone anyway.
            const y = Math.max(0, top);
            files.push(await shoot(page, 'search', { x: 0, y, width: 390, height: 844 }));
        }

        if (want('profile')) {
            await go(page, `/adopter/${ADOPTER.perez}`);
            await scrollUnderNav(page, page.getByText('Actividad', { exact: true }), 76);
            files.push(await shoot(page, 'profile'));
        }

        if (want('privacy')) {
            const p2 = await other.newPage();
            await go(p2, `/adopter/${ADOPTER.perez}`);
            // Masked contacts; tapping one opens «verificá lo que sabés … o solicitar acceso».
            const chip = p2.locator('[aria-label*="Dato de contacto protegido"]').first();
            await chip.waitFor({ timeout: 30_000 });
            await scrollUnderNav(p2, p2.getByText('Juan Pérez', { exact: true }), 80);
            await chip.click();
            await p2.getByText('o solicitar acceso si no conocés más datos').waitFor({ timeout: 15_000 });
            // The one-time «Novedad» notice inside the sheet: dismiss it with its own button.
            const gotIt = p2.getByRole('button', { name: 'Entendido' });
            if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
            await p2.waitForTimeout(700);
            await p2.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur());
            files.push(await shoot(p2, 'privacy', undefined, { keepOpen: true }));
            await p2.close();
        }

        if (want('form-results') && submissionId) {
            await go(page, `/form-results/${submissionId}`);
            await page.locator('[data-signal]').first().waitFor({ timeout: 30_000 });
            const risk = await page.locator('[data-signal="risk"]').count();
            const caution = await page.locator('[data-signal="caution"]').count();
            const ok = await page.locator('[data-signal="ok"]').count();
            if (!risk || !caution || !ok) warnings.push(`form-results: signals ok=${ok} caution=${caution} risk=${risk}`);
            await scrollUnderNav(page, page.getByText('Datos del adoptante', { exact: true }), 80);
            files.push(await shoot(page, 'form-results'));
        }

        if (want('contract')) {
            await go(page, `/contract-results/${CONTRACT_NOTIF}`);
            files.push(await shoot(page, 'contract'));
        }

        if (want('animals')) {
            await go(page, '/my-animals');
            await page.getByText('Mora').first().waitFor({ timeout: 30_000 });
            await settle(page);
            // Tabs + the first cards, past the page intro.
            await scrollUnderNav(page, page.getByText(/Disponibles \(/).first(), 84);
            files.push(await shoot(page, 'animals'));
        }

        if (want('animal-timeline')) {
            await go(page, `/my-animals/${P}animal-felipe`);
            files.push(await shoot(page, 'animal-timeline'));
        }

        if (want('notifications')) {
            await go(page, '/notificaciones');
            await page.getByText('Valentina').first().waitFor({ timeout: 30_000 }).catch(() => warnings.push('notifications: form notification not visible'));
            files.push(await shoot(page, 'notifications'));
        }

        if (want('team')) {
            await go(page, '/organizations');
            await page.getByText(ORG.name).first().waitFor({ timeout: 30_000 });
            // The «¿Qué son las organizaciones?» explainer starts folded (org-banner-dismissed).
            await settle(page);
            files.push(await shoot(page, 'team'));
        }

        if (want('custom-docs')) {
            await go(page, '/settings/adoption-docs');
            files.push(await shoot(page, 'custom-docs'));
        }
    } finally {
        await browser.close();
    }
    return files;
}

async function compress(files) {
    const sharp = (await import('sharp')).default;
    for (const f of files) {
        const before = fs.statSync(f).size;
        const buf = await sharp(f).png({ palette: true, quality: 85, compressionLevel: 9, effort: 10 }).toBuffer();
        if (buf.length < before) fs.writeFileSync(f, buf);
        const size = fs.statSync(f).size;
        if (size > 600 * 1024) {
            const webp = f.replace(/\.png$/, '.webp');
            await sharp(f).webp({ quality: 82 }).toFile(webp);
            log(`${path.basename(f)} is ${Math.round(size / 1024)}KB — also wrote ${path.basename(webp)}`);
        }
        const meta = await sharp(f).metadata();
        log(`${path.relative(ROOT, f)}  ${meta.width}x${meta.height}  ${Math.round(fs.statSync(f).size / 1024)}KB`);
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

// What an interrupted run must undo. Signals (Ctrl-C during the long dev-server
// boot) and crashes skip `finally`, and the dev server is detached so it never
// sees the terminal's SIGINT — without this the tracked DBs would be left
// holding the showcase data and :PORT would stay busy.
const cleanup = { child: null, backups: null, done: false };
let resumeServe = null;

function restoreDatabases() {
    if (cleanup.done || KEEP_DB || !cleanup.backups) return;
    cleanup.done = true;
    for (const [src, dst] of cleanup.backups) {
        if (!fs.existsSync(dst)) continue;
        removeSidecars(src);
        fs.copyFileSync(dst, src);
    }
    log('databases restored');
}

function emergencyExit(reason) {
    console.error(`[shots] ${reason} — stopping the server and restoring the databases`);
    if (cleanup.child) { try { process.kill(-cleanup.child.pid, 'SIGKILL'); } catch { /* gone */ } }
    try { restoreDatabases(); } catch (e) { console.error(`[shots] RESTORE FAILED — copy the backups in ${WORK} back by hand:`, e); }
    process.exit(130);
}

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
        // --serve waits for Ctrl-C on purpose: finish normally through `finally`.
        if (resumeServe) { const r = resumeServe; resumeServe = null; r(); return; }
        emergencyExit(sig);
    });
}
process.on('uncaughtException', (e) => { console.error(e); emergencyExit('uncaught exception'); });

/**
 * The script swaps the tracked `local.db` / `.wrangler` sqlite in place, so it
 * only runs when they hold nothing worth keeping: committed content, and no
 * WAL sidecars (a dev server on another port may be writing to them).
 */
function assertDatabasesSafeToSwap(files) {
    const dirty = execSync(`git status --porcelain -- ${files.map(f => JSON.stringify(path.relative(ROOT, f))).join(' ')}`, { cwd: ROOT }).toString().trim();
    if (dirty) {
        throw new Error(`Refusing to run: the local databases have uncommitted changes —\n${dirty}\n` +
            'Run this in a clean worktree (git worktree add …) instead of a checkout with local DB edits.');
    }
    const sidecars = files.flatMap(f => ['-wal', '-shm', '-journal'].map(x => f + x)).filter(f => fs.existsSync(f) && fs.statSync(f).size > 0);
    if (sidecars.length) {
        throw new Error(`Refusing to run: ${sidecars.map(f => path.relative(ROOT, f)).join(', ')} exist — a dev server may be using the DB. Stop it first.`);
    }
}

async function main() {
    if (!AUTH_SECRET) throw new Error('AUTH_SECRET missing — copy .env.local from the main checkout (never commit it).');
    fs.mkdirSync(OUT_DIR, { recursive: true });

    const wrangler = wranglerDbPath();
    const backups = [[LOCAL_DB, path.join(WORK, 'local.db.bak')], [wrangler, path.join(WORK, 'wrangler.sqlite.bak')]];
    if (portBusy(PORT)) throw new Error(`Port ${PORT} is in use — stop that server first.`);
    if (!KEEP_DB) assertDatabasesSafeToSwap([LOCAL_DB, wrangler]);
    for (const [src, dst] of backups) { if (fs.existsSync(src)) fs.copyFileSync(src, dst); }
    cleanup.backups = backups;
    log(`backed up databases to ${WORK}`);

    let server;
    try {
        const mods = {
            schema: await jiti.import(path.join(ROOT, 'src/db/schema.ts')),
            tokenizer: await jiti.import(path.join(ROOT, 'src/lib/tokenizer.ts')),
            contactEntries: await jiti.import(path.join(ROOT, 'src/lib/contactEntries.ts')),
            householdMembers: await jiti.import(path.join(ROOT, 'src/lib/householdMembers.ts')),
            followupCopy: await jiti.import(path.join(ROOT, 'workers/followup-cron/src/copy.ts')),
            drizzle: (await import('drizzle-orm/better-sqlite3')).drizzle,
            ...(await import('drizzle-orm')),
        };

        const fresh = path.join(WORK, 'showcase.sqlite');
        const sqlite = await buildFreshDb(fresh, mods.schema, backups[1][1]);
        await seed(sqlite, mods);
        const leftovers = sqlite.prepare(`SELECT name FROM adopters WHERE id NOT LIKE '${P}%' AND deleted_at IS NULL`).all();
        if (leftovers.length) throw new Error(`Unexpected adopters in the fresh DB: ${leftovers.map(r => r.name).join(', ')}`);
        sqlite.close();

        for (const target of [wrangler, LOCAL_DB]) { removeSidecars(target); fs.copyFileSync(fresh, target); }
        log('showcase database in place');

        server = await startServer();
        const submissionId = (!ONLY || ONLY.has('form-results') || ONLY.has('notifications')) ? await submitForm() : null;
        if (SERVE) {
            log(`serving ${BASE} — form submission ${submissionId}; Ctrl-C to stop and restore`);
            await new Promise(resolve => { resumeServe = resolve; });
        } else {
            const files = await capture(submissionId);
            await compress(files);
        }
    } finally {
        if (server) await stopServer(server.child);
        cleanup.child = null;
        restoreDatabases();
        if (warnings.length) { console.log('\nWarnings:'); warnings.forEach(w => console.log(' -', w)); }
    }
}

main().catch((e) => { console.error('[shots] FAILED:', e); process.exitCode = 1; });
