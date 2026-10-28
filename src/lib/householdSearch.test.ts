/**
 * Households as profiles, Task 5 — search and duplicate detection under the
 * new model (spec «Search and duplicate detection (Jon, 2026-10-26)»):
 * - each profile tokenizes only itself (a host's legacy household JSON adds no tokens);
 * - a search returns only the profiles that match, each carrying its household line
 *   (housemates' live rating and alerts, «Menor de edad»);
 * - the duplicate scan and «Pendientes de revisar» never pair two housemates;
 * - API exact mode never answers `household_member`.
 * Real SQL (every drizzle/*.sql replayed), the real token index, search engine,
 * scan route and exact matcher.
 *
 * Pedro (★1, one open alert), Marta (★4) and Lucas (12, minor) live together;
 * Lucas also lives with Ana (★3) in another home. Rosa is nobody's housemate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { session, OWNER, ADMIN } = mocks;
const OTHER = 'other-rescuer@example.com';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));

vi.mock('@/app/actions/_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/auth', () => ({ auth: vi.fn(async () => (session.user ? { user: { email: session.user, name: 'R' } } : null)) }));
vi.mock('@/lib/requestContext', () => ({ getRequestContext: () => ({ env: {} }) }));
vi.mock('@/config/admins', async (orig) => ({
    ...(await orig()),
    isAdminAsync: mocks.isAdmin,
    isModeratorOrAdminAsync: mocks.isAdmin,
    isAdmin: (e: string | null | undefined) => e === ADMIN,
}));
vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig()), isOrgMate: mocks.isOrgMate, getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor,
    getTeamEmails: async (e: string) => mocks.getOrgMemberEmailsFor(e),
    isOwnerOrOrgMate: (v: string | null | undefined, o: string | null | undefined) => mocks.isOwnerOrOrgMate(v?.trim().toLowerCase(), o?.trim().toLowerCase()),
}));
vi.mock('@/config/features', async (orig) => ({
    ...(await orig()),
    getFeatureFlag: vi.fn(async (flag: string) => flag === 'ENABLE_PII_ACCESS_GATING' || flag === 'ENABLE_GUEST_NAME_MASK'),
}));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async (_n: string, task: () => Promise<unknown>) => { await task(); }) }));
vi.mock('@/app/actions/notifications', () => ({
    createNotification: vi.fn(async () => 'n'),
    notifyAdmins: vi.fn(async () => undefined),
    notifyOrgMembers: vi.fn(async () => undefined),
    resolveDisplayName: vi.fn(async (email: string) => email.split('@')[0]),
    resolveDisplayNames: vi.fn(async (emails: string[]) => Object.fromEntries(emails.map(e => [e, e.split('@')[0]]))),
}));
// Wrapped, not replaced: counts the gift-form reads of the scan (audit A5) and still reads them.
vi.mock('@/lib/giftRecipients', async (orig) => {
    const real = await orig<typeof import('./giftRecipients')>();
    return { ...real, giftPhoneEntriesByGiver: vi.fn(real.giftPhoneEntriesByGiver) };
});
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
    withTrace: (_op: string, fn: () => unknown) => fn(),
}));

import { tokenizeAdopter } from './adopterTokenize';
import { giftPhoneEntriesByGiver } from './giftRecipients';
import { addMembership, createHousehold, householdLinesFor, withHouseholdLines, HOUSEHOLD_LINE_CARDS } from './households';
import { MAX_HOUSEHOLD_LINES } from '@/domain/households';
import { enrichAdopters } from '@/app/actions/enrichAdopters';
import { logger } from '@/lib/logger';
import { findAdopters, findAdoptersAsViewer } from '@/app/actions/findAdopters';
import { searchFormDuplicates } from './formDuplicates';
import { addHouseholdPerson, getHouseholdMatchCandidates } from '@/app/actions/households';
import { getDuplicateCandidates, getPendingDuplicatesForUser, mergePendingDedupPair } from '@/app/actions/duplicates';
import { findIdentifierHits } from './api/profiles';
import { decideExactOutcome } from '@/domain/apiExactMatch';
import { POST as scan } from '@/app/api/admin/duplicates/route';
import type { DiscoveryMatch } from '@/app/actions/types';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };
const db = () => state.db as Parameters<typeof addMembership>[0];

const LUCAS_PHONE = '+54 9 11 4200 0003';
const HOME_PHONE = '+54 9 11 6123 4455';
const tokensOf = (adopterId: string) => sqlite.prepare('SELECT token_type || \':\' || token_value AS t FROM duplicate_tokens WHERE adopter_id = ?').all(adopterId).map(r => r.t as string);
const ids = (list: DiscoveryMatch[] | undefined) => (list ?? []).map(r => r.adopterId);

async function inHousehold(id: string, people: string[]) {
    await createHousehold(db(), OWNER, id);
    for (const p of people) await addMembership(db(), { householdId: id, adopterId: p, addedBy: OWNER });
}

beforeEach(async () => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    session.user = OWNER;
    const insert = sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, country, created_at, updated_at, contact_entries, household_members, age, age_as_of)
        VALUES (?, ?, '5', ?, 'AR', 1000, 1000, ?, ?, ?, ?)`);
    const phone = (id: string, value: string, by: string) => JSON.stringify([{ id, type: 'phone', value, addedBy: by }]);
    // Pedro still carries the pre-conversion inline JSON naming Lucas and his phone.
    insert.run('pedro', 'Pedro Paez', OWNER, phone('pc', HOME_PHONE, OWNER),
        JSON.stringify([{ id: 'hm1', name: 'Lucas Paez', relationship: 'child', contactEntries: [{ id: 'lc0', type: 'phone', value: LUCAS_PHONE, addedBy: OWNER }] }]), null, null);
    insert.run('marta', 'Marta Paez', OTHER, phone('mc', '+54 9 11 4444 0303', OTHER), null, null, null);
    insert.run('lucas', 'Lucas Paez', OWNER, phone('lc', LUCAS_PHONE, OWNER), null, 12, '2026-01-01');
    insert.run('ana', 'Ana Gómez', OTHER, phone('ac', '+54 9 11 5555 1212', OTHER), null, null, null);
    insert.run('rosa', 'Rosa Diaz', OTHER, phone('rc', '+54 9 11 7777 8888', OTHER), null, null, null);
    // Ratings live on records; Pedro also has an open alert.
    const animal = sqlite.prepare(`INSERT INTO animals (id, name, added_by) VALUES (?, ?, ?)`);
    for (const [id, name] of [['an1', 'Tom'], ['an2', 'Kiki'], ['an3', 'Bolt']]) animal.run(id, name, OWNER);
    const rate = sqlite.prepare(`INSERT INTO placements (id, animal_id, adopter_id, record_type, rating) VALUES (?, ?, ?, 'adoption', ?)`);
    rate.run('p1', 'an1', 'pedro', 1);
    rate.run('p2', 'an2', 'marta', 4);
    rate.run('p3', 'an3', 'ana', 3);
    sqlite.prepare(`INSERT INTO adopter_flags (id, adopter_id, flagged_by, reason) VALUES ('f1', 'pedro', ?, 'inaccurate_information')`).run(OTHER);
    await inHousehold('hh-pedro', ['pedro', 'marta', 'lucas']);
    await inHousehold('hh-ana', ['ana', 'lucas']);
    for (const id of ['pedro', 'marta', 'lucas', 'ana', 'rosa']) await tokenizeAdopter(id);
});

describe('tokens: each profile tokenizes only itself (v8)', () => {
    it("the host's tokens no longer carry its member's phone or name; the member's own profile does", () => {
        const pedro = tokensOf('pedro');
        expect(pedro.some(t => t.includes('42000003'))).toBe(false);
        expect(pedro).not.toContain('name_word:lucas');
        expect(pedro).not.toContain('name_full:lucas paez');
        const lucas = tokensOf('lucas');
        expect(lucas.some(t => t.startsWith('phone') && t.includes('42000003'))).toBe(true);
        expect(lucas).toContain('name_full:lucas paez');
    });

    it('legacy familyMembers free text is still a name token of the host', async () => {
        sqlite.prepare(`UPDATE adopters SET family_members = 'Tía Clara Sosa' WHERE id = 'pedro'`).run();
        await tokenizeAdopter('pedro');
        expect(tokensOf('pedro')).toEqual(expect.arrayContaining(['name_word:clara', 'name_word:sosa']));
    });
});

describe("search returns only the people who match, each with its household line", () => {
    it("the member's name + phone → only the member, with Pedro ★1 · 1 alerta, Marta ★4 and Ana in another home", async () => {
        const res = await findAdopters({ raw: 'Lucas Paez 11 4200-0003' }, { mode: 'discovery' });
        expect(ids(res.results as DiscoveryMatch[])).toEqual(['lucas']);
        // Pedro never rides in on Lucas's phone or name: at most a weak hit on his own surname.
        for (const r of (res.lowRelevanceResults ?? []) as DiscoveryMatch[]) {
            expect(r.matchTypes.some(t => t.startsWith('family'))).toBe(false);
        }
        const lucas = (res.results as DiscoveryMatch[])[0];
        expect(lucas.isMinor).toBe(true);
        expect(lucas.households).toEqual([
            { name: 'Pedro Paez', profileId: 'pedro', rating: 1, openAlerts: 1, isMinor: false, isGift: false, householdId: 'hh-pedro' },
            { name: 'Marta Paez', profileId: 'marta', rating: 4, openAlerts: 0, isMinor: false, isGift: false, householdId: 'hh-pedro' },
            { name: 'Ana Gómez', profileId: 'ana', rating: 3, openAlerts: 0, isMinor: false, isGift: false, householdId: 'hh-ana' },
        ]);
    });

    it("the member's phone alone → only the member's card, Pedro nowhere", async () => {
        const res = await findAdopters({ raw: '11 4200-0003' }, { mode: 'discovery' });
        expect(ids(res.results as DiscoveryMatch[])).toEqual(['lucas']);
        expect(ids(res.lowRelevanceResults as DiscoveryMatch[])).not.toContain('pedro');
    });

    it("Pedro's own card lists Lucas as «Menor de edad» (no rating)", async () => {
        const res = await findAdopters({ raw: 'Pedro Paez' }, { mode: 'discovery' });
        const pedro = (res.results as DiscoveryMatch[]).find(r => r.adopterId === 'pedro')!;
        expect(pedro.isMinor).toBe(false);
        expect(pedro.households?.find(l => l.profileId === 'lucas')).toMatchObject({ name: 'Lucas Paez', isMinor: true, rating: null });
    });

    it('a profile with no household gets an empty line', async () => {
        const res = await findAdopters({ raw: 'Rosa Diaz' }, { mode: 'discovery' });
        expect((res.results as DiscoveryMatch[]).find(r => r.adopterId === 'rosa')!.households).toEqual([]);
    });

    it('a logged-out visitor gets no household names (guest name mask)', async () => {
        session.user = null;
        const res = await findAdopters({ raw: 'Lucas Paez' }, { mode: 'discovery' });
        const all = [...(res.results ?? []), ...(res.lowRelevanceResults ?? [])] as DiscoveryMatch[];
        expect(all.length).toBeGreaterThan(0);
        for (const r of all) expect(r.households).toBeUndefined();
        expect(JSON.stringify(res)).not.toContain('Ana Gómez');
    });
});

describe('«¿Es este perfil?» cards carry the household line', () => {
    it('the «Nuevo adoptante» check (findFormDuplicates) → the candidate with its housemates and minor tag', async () => {
        const { results } = await searchFormDuplicates({ name: 'Lucas Paez', phones: ['11 4200-0003'] }, {}, async () => OWNER);
        const lucas = results.find(r => r.adopter.id === 'lucas')!;
        expect(lucas.isMinor).toBe(true);
        expect(lucas.households?.map(l => l.name)).toEqual(['Pedro Paez', 'Marta Paez', 'Ana Gómez']);
    });

    it('the household add form keeps its householdLine (same data)', async () => {
        const { results } = await getHouseholdMatchCandidates({ name: 'Lucas Paez', contactEntries: [{ type: 'phone', value: '11 4200-0003' }] });
        const lucas = results.find(r => r.adopter.id === 'lucas')!;
        expect(lucas.householdLine.map(l => l.profileId)).toEqual(['pedro', 'marta', 'ana']);
    });
});

describe('duplicate detection never pairs two housemates', () => {
    beforeEach(async () => {
        // A shared home landline: Marta and an outsider (Rosa) carry Pedro's phone too.
        const shared = (id: string, by: string) => JSON.stringify([{ id: `${id}-h`, type: 'phone', value: HOME_PHONE, addedBy: by }]);
        sqlite.prepare('UPDATE adopters SET contact_entries = ? WHERE id = ?').run(shared('marta', OTHER), 'marta');
        sqlite.prepare('UPDATE adopters SET contact_entries = ? WHERE id = ?').run(shared('rosa', OTHER), 'rosa');
        await tokenizeAdopter('marta');
        await tokenizeAdopter('rosa');
    });

    it('the scan pairs the outsider with each of them, never Pedro with Marta', async () => {
        session.user = ADMIN;
        const res = await scan(new Request('http://localhost/api/admin/duplicates?limit=200', { method: 'POST' }));
        expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
        const pairs = sqlite.prepare(`SELECT adopter1_id || '|' || adopter2_id AS k FROM duplicate_candidates WHERE status = 'pending'`).all().map(r => r.k);
        expect(pairs).toEqual(expect.arrayContaining(['pedro|rosa', 'marta|rosa']));
        expect(pairs).not.toContain('marta|pedro');
    });

    it('«Scan Now» reads the gift forms once per scan, not once per batch (audit A5)', async () => {
        session.user = ADMIN;
        sqlite.prepare('UPDATE adopters SET token_hash = NULL').run();
        const reads = vi.mocked(giftPhoneEntriesByGiver);
        reads.mockClear();
        const batch = (scanId?: string) => scan(new Request(`http://localhost/api/admin/duplicates?limit=1${scanId ? `&scan=${scanId}` : ''}`, { method: 'POST' }));
        const first = await (await batch('scan-0001-aaaa')).json();
        const second = await (await batch('scan-0001-aaaa')).json();
        expect(first.tokenized).toBe(1);
        expect(second.tokenized).toBe(1);
        expect(second.remaining).toBe(first.remaining - 1);
        expect(reads).toHaveBeenCalledTimes(1);
        await batch('scan-0002-bbbb');
        expect(reads).toHaveBeenCalledTimes(2);
        // No scan id (an external caller): a fresh read every batch, as before.
        await batch();
        await batch();
        expect(reads).toHaveBeenCalledTimes(4);
    });

    it('a gift household does not count: giver and recipient may be one person, so they still pair', async () => {
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, country, created_at, updated_at, contact_entries) VALUES ('gift', 'Sofia Paez', '5', ?, 'AR', 1000, 1000, ?)`)
            .run(OWNER, JSON.stringify([{ id: 'g', type: 'phone', value: HOME_PHONE, addedBy: OWNER }]));
        await tokenizeAdopter('gift');
        await createHousehold(db(), OWNER, 'hh-gift-1');
        await addMembership(db(), { householdId: 'hh-gift-1', adopterId: 'gift', giftRecipient: true, relativeToAdopterId: 'pedro', addedBy: OWNER });
        await addMembership(db(), { householdId: 'hh-gift-1', adopterId: 'pedro', addedBy: null });
        session.user = ADMIN;
        await scan(new Request('http://localhost/api/admin/duplicates?limit=200', { method: 'POST' }));
        const pairs = sqlite.prepare(`SELECT adopter1_id || '|' || adopter2_id AS k FROM duplicate_candidates WHERE status = 'pending'`).all().map(r => r.k);
        expect(pairs).toContain('gift|pedro');
    });

    it('«Pendientes de revisar» skips a detected housemate pair left from before (and does not count it)', async () => {
        const ins = sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status, detected_at) VALUES (?, ?, ?, '["phone"]', 60, 'high', 'pending', 1000)`);
        ins.run('c-housemates', 'marta', 'pedro');
        ins.run('c-outsider', 'pedro', 'rosa');
        const { pairs, total } = await getPendingDuplicatesForUser(1, 10, true);
        expect(pairs.map(p => p.candidateId)).toEqual(['c-outsider']);
        expect(total).toBe(1);
    });

    it('a merge request someone filed on a housemate pair stays listed (a person asked): only detection is filtered', async () => {
        const ins = sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status, detected_at) VALUES (?, ?, ?, '["phone"]', 60, 'high', 'pending', 1000)`);
        ins.run('c-housemates', 'marta', 'pedro');
        sqlite.prepare(`INSERT INTO merge_requests (id, primary_id, secondary_id, candidate_id, requester_email, owner_email, status, created_at) VALUES ('mr1', 'pedro', 'marta', 'c-housemates', ?, ?, 'pending', 1)`)
            .run(mocks.STRANGER, OWNER);
        const { pairs, total } = await getPendingDuplicatesForUser(1, 10, true);
        expect(pairs.map(p => [p.candidateId, p.group])).toEqual([['c-housemates', 'received']]);
        expect(pairs[0].request).not.toBeNull();
        expect(total).toBe(1);
    });

    it("the profile's duplicate banner skips it too", async () => {
        const ins = sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status, detected_at) VALUES (?, ?, ?, '["phone"]', 60, 'high', 'pending', 1000)`);
        ins.run('c-housemates', 'marta', 'pedro');
        ins.run('c-outsider', 'pedro', 'rosa');
        expect((await getDuplicateCandidates('pedro')).map(c => c.otherAdopterId)).toEqual(['rosa']);
    });
});

describe('API exact mode: the member is an ordinary profile match', () => {
    it("the member's phone + name → found on the member, the host not even a candidate", async () => {
        const hits = await findIdentifierHits(db(), { fullName: 'Lucas Paez', phone: '11 4200-0003' }, 'req', 'AR');
        expect(hits.candidates.map(c => c.profileId)).toEqual(['lucas']);
        expect(decideExactOutcome('Lucas Paez', hits.candidates)).toEqual({ result: 'found', profileId: 'lucas', nameMatchedAs: 'profile', otherProfileIds: [] });
    });

    it("a housemate's name on the host's phone is no longer a «household_member» match on the host", async () => {
        const hits = await findIdentifierHits(db(), { fullName: 'Marta Paez', phone: '11 6123-4455' }, 'req', 'AR');
        const outcome = decideExactOutcome('Marta Paez', hits.candidates);
        expect(outcome).toMatchObject({ result: 'ambiguous', reason: 'name_mismatch', profileIds: ['pedro'] });
    });
});

// ─────────────────────────── Fix round 1 ───────────────────────────

const candidate = (id: string, a: string, b: string, score = 60) =>
    sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status, detected_at) VALUES (?, ?, ?, '["phone"]', ?, 'high', 'pending', 1000)`)
        .run(id, a < b ? a : b, a < b ? b : a, score);
const pending = () => sqlite.prepare(`SELECT id FROM duplicate_candidates WHERE status = 'pending' ORDER BY id`).all().map(r => r.id);
const addPeople = (n: number, prefix: string) => {
    const ins = sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, country, created_at, updated_at) VALUES (?, ?, '5', ?, 'AR', 1000, 1000)`);
    const ids: string[] = [];
    for (let i = 0; i < n; i++) { const id = `${prefix}${String(i).padStart(2, '0')}`; ins.run(id, `Persona ${prefix} ${i}`, OTHER); ids.push(id); }
    return ids;
};

describe('fix round 1 — banner, badge and joins never pair housemates', () => {
    it('I1: five stronger housemate pairs cannot hide a real duplicate from the profile banner', async () => {
        const mates = addPeople(3, 'hm');
        for (const m of mates) await addMembership(db(), { householdId: 'hh-pedro', adopterId: m, addedBy: OWNER });
        // Inserted before Pedro joined anyone? No: pairs left from before they lived together.
        for (const [i, m] of ['marta', 'lucas', ...mates].entries()) candidate(`c-hm-${i}`, 'pedro', m, 90);
        candidate('c-real', 'pedro', 'rosa', 40);
        expect((await getDuplicateCandidates('pedro')).map(c => c.otherAdopterId)).toEqual(['rosa']);
    });

    it('I3: the «posible duplicado» badge (and the API\'s possible_duplicate) ignores a housemate pair', async () => {
        candidate('c-hm', 'pedro', 'marta');
        expect((await enrichAdopters(db(), ['pedro', 'marta'])).get('pedro')!.flags.systemDuplicate).toBe(false);
        candidate('c-real', 'pedro', 'rosa');
        expect((await enrichAdopters(db(), ['pedro'])).get('pedro')!.flags.systemDuplicate).toBe(true);
    });

    it('I3: joining a household removes the pending duplicate pairs with the new housemates only', async () => {
        candidate('c-join-pedro', 'rosa', 'pedro');
        candidate('c-join-marta', 'rosa', 'marta');
        candidate('c-other', 'rosa', 'ana');
        // Final fix S3: only when the caller may clear them (here: forced, as a merge / D35 does).
        await addMembership(db(), { householdId: 'hh-pedro', adopterId: 'rosa', addedBy: OWNER, clearPairs: { force: true } });
        expect(pending()).toEqual(['c-other']);
    });

    it('I3: a gift household is no home: joining it removes nothing', async () => {
        candidate('c-gift', 'rosa', 'pedro');
        await createHousehold(db(), OWNER, 'hh-gift-x');
        await addMembership(db(), { householdId: 'hh-gift-x', adopterId: 'rosa', giftRecipient: true, relativeToAdopterId: 'pedro', addedBy: OWNER, clearPairs: { force: true } });
        await addMembership(db(), { householdId: 'hh-gift-x', adopterId: 'pedro', addedBy: null, clearPairs: { force: true } });
        expect(pending()).toEqual(['c-gift']);
    });
});

describe('fix round 1 — household lines stay cheap', () => {
    const countQueries = async <T>(run: () => Promise<T>) => {
        const raw = sqlite as unknown as { prepare: (...a: unknown[]) => unknown };
        const orig = raw.prepare;
        let n = 0;
        raw.prepare = function (this: unknown, ...a: unknown[]) { n++; return orig.apply(this, a); };
        try { return { result: await run(), n }; } finally { raw.prepare = orig; }
    };

    it('I2: a 20-card page costs at most 1 + 20×6 queries for its lines', async () => {
        const cards = [...['lucas', 'pedro', 'ana', 'rosa'], ...addPeople(16, 'pg')].map(adopterId => ({ adopterId }));
        const { result, n } = await countQueries(() => withHouseholdLines(db(), OWNER, cards));
        expect(result.find(c => c.adopterId === 'lucas')!.households!.map(l => l.profileId)).toEqual(['pedro', 'marta', 'ana']);
        expect(n).toBeLessThanOrEqual(1 + 20 * 6);
    });

    it('I2: only the first HOUSEHOLD_LINE_CARDS cards get a line', async () => {
        const ids = addPeople(HOUSEHOLD_LINE_CARDS + 5, 'cap');
        const out = await withHouseholdLines(db(), OWNER, ids.map(adopterId => ({ adopterId })));
        expect(out.filter(c => 'households' in c)).toHaveLength(HOUSEHOLD_LINE_CARDS);
        expect('households' in out[HOUSEHOLD_LINE_CARDS]).toBe(false);
    });

    it('I2: enrich:false callers (AdopterFlagging) get no household line', async () => {
        const res = await findAdopters({ raw: 'Lucas Paez' }, { mode: 'discovery', enrich: false });
        expect((res.results as DiscoveryMatch[]).length).toBeGreaterThan(0);
        for (const r of res.results as DiscoveryMatch[]) expect(r.households).toBeUndefined();
    });

    it('the API (findAdoptersAsViewer, origin api) gets no household line', async () => {
        const res = await findAdoptersAsViewer({ raw: 'Lucas Paez' }, { enrich: true }, OWNER);
        expect((res.results as DiscoveryMatch[]).map(r => r.adopterId)).toContain('lucas');
        for (const r of [...res.results, ...(res.lowRelevanceResults ?? [])] as DiscoveryMatch[]) expect(r.households).toBeUndefined();
    });

    it('a household read failure leaves the card without a line (logged), never the search', async () => {
        sqlite.prepare('DROP TABLE household_memberships').run();
        vi.mocked(logger.warn).mockClear();
        const res = await findAdopters({ raw: 'Rosa Diaz' }, { mode: 'discovery' });
        expect((res.results as DiscoveryMatch[]).find(r => r.adopterId === 'rosa')!.households).toEqual([]);
        expect(vi.mocked(logger.warn).mock.calls.some(([msg]) => String(msg).startsWith('households:'))).toBe(true);
    });

    it('gift-only housemates never take a slot from someone who lives there', async () => {
        // Pedro's OLDEST household is a gift one; his home has 11 other people.
        await createHousehold(db(), OWNER, 'hh-gift-old');
        await addMembership(db(), { householdId: 'hh-gift-old', adopterId: 'rosa', giftRecipient: true, relativeToAdopterId: 'pedro', addedBy: OWNER, addedAt: new Date(1000) });
        await addMembership(db(), { householdId: 'hh-gift-old', adopterId: 'pedro', addedBy: null, addedAt: new Date(1000) });
        for (const m of addPeople(9, 'big')) await addMembership(db(), { householdId: 'hh-pedro', adopterId: m, addedBy: OWNER });
        const out = await withHouseholdLines(db(), OWNER, [{ adopterId: 'pedro' }]);
        const lines = out[0].households!;
        expect(lines).toHaveLength(MAX_HOUSEHOLD_LINES);
        expect(lines.every(l => !l.isGift)).toBe(true);
    });
});

// ─────────────────────────── Final fix S3 ───────────────────────────

const typedCandidate = (id: string, a: string, b: string, types: string[]) =>
    sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status, detected_at) VALUES (?, ?, ?, ?, 80, 'high', 'pending', 1000)`)
        .run(id, a < b ? a : b, a < b ? b : a, JSON.stringify(types));

describe('final fix S3 — declaring two profiles housemates never erases a real duplicate pair', () => {
    it('a stranger linking someone into a home leaves the pending pairs (not privileged on both)', async () => {
        candidate('c-rosa-pedro', 'rosa', 'pedro');
        session.user = mocks.STRANGER;
        expect(await addHouseholdPerson({ anchorAdopterId: 'pedro', existingProfileId: 'rosa', relationship: 'unknown' })).toMatchObject({ ok: true });
        expect(pending()).toContain('c-rosa-pedro');
    });

    it("someone privileged on only one side leaves the pair; privileged on both removes it", async () => {
        candidate('c-rosa-pedro', 'rosa', 'pedro');
        session.user = OWNER; // owns Pedro, not Rosa (OTHER's)
        expect(await addHouseholdPerson({ anchorAdopterId: 'pedro', existingProfileId: 'rosa', relationship: 'unknown' })).toMatchObject({ ok: true });
        expect(pending()).toContain('c-rosa-pedro');
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, country, created_at, updated_at) VALUES ('mine', 'Mía Paez', '5', ?, 'AR', 1000, 1000)`).run(OWNER);
        candidate('c-mine-lucas', 'mine', 'lucas');
        expect(await addHouseholdPerson({ anchorAdopterId: 'lucas', existingProfileId: 'mine', relationship: 'unknown', householdId: 'hh-pedro' } as never)).toMatchObject({ ok: true });
        expect(pending()).not.toContain('c-mine-lucas');
    });

    it('a pair sharing an email or an ID number is never hidden as housemates (banner, badge, Pendientes, scan); a shared phone still is', async () => {
        typedCandidate('c-email', 'pedro', 'marta', ['email', 'name_word']);
        typedCandidate('c-phone', 'lucas', 'marta', ['phone']);
        typedCandidate('c-id', 'ana', 'lucas', ['id_number']);
        expect((await getDuplicateCandidates('pedro')).map(c => c.otherAdopterId)).toEqual(['marta']);
        expect((await getDuplicateCandidates('lucas')).map(c => c.otherAdopterId)).toEqual(['ana']);
        expect((await enrichAdopters(db(), ['pedro'])).get('pedro')!.flags.systemDuplicate).toBe(true);
        const { pairs } = await getPendingDuplicatesForUser(1, 10, true);
        expect(pairs.map(p => p.candidateId).sort()).toEqual(['c-email', 'c-id']);
    });

    it('the scan pairs housemates who share an email', async () => {
        const mail = (id: string, by: string) => ({ id, type: 'email', value: 'paez.familia@example.com', addedBy: by });
        sqlite.prepare(`UPDATE adopters SET contact_entries = ? WHERE id = 'pedro'`).run(JSON.stringify([{ id: 'pc', type: 'phone', value: HOME_PHONE, addedBy: OWNER }, mail('pm', OWNER)]));
        sqlite.prepare(`UPDATE adopters SET contact_entries = ? WHERE id = 'marta'`).run(JSON.stringify([mail('mm', OTHER)]));
        await tokenizeAdopter('pedro');
        await tokenizeAdopter('marta');
        session.user = ADMIN;
        await scan(new Request('http://localhost/api/admin/duplicates?limit=200', { method: 'POST' }));
        const pairs = sqlite.prepare(`SELECT adopter1_id || '|' || adopter2_id AS k FROM duplicate_candidates WHERE status = 'pending'`).all().map(r => r.k);
        expect(pairs).toContain('marta|pedro');
    });

    it('«alguien de su hogar» (D35) removes the pair even across teams', async () => {
        // hh-pedro is Pedro's own home (his anchor row), so the answer puts Rosa there, with Marta.
        sqlite.prepare("UPDATE household_memberships SET added_by = NULL WHERE household_id = 'hh-pedro' AND adopter_id = 'pedro'").run();
        candidate('c-rosa-pedro', 'rosa', 'pedro');
        candidate('c-rosa-marta', 'rosa', 'marta');
        session.user = OWNER;
        expect(await mergePendingDedupPair('c-rosa-pedro', { identity: 'household' })).toMatchObject({ success: true, outcome: 'household' });
        expect(pending()).not.toContain('c-rosa-marta');
    });
});

describe('final fix P2 — «Pendientes de revisar» shows each side as every card does', () => {
    it('the household line and «Menor de edad» on a pair side', async () => {
        candidate('c-out', 'lucas', 'rosa');
        const { pairs } = await getPendingDuplicatesForUser(1, 10, true);
        const pair = pairs.find(p => p.candidateId === 'c-out')!;
        const lucas = [pair.newAdopter, pair.existingAdopter].find(s => s.id === 'lucas')!;
        expect(lucas.isMinor).toBe(true);
        expect((lucas.households ?? []).map(l => l.profileId).sort()).toEqual(['ana', 'marta', 'pedro']);
        const rosa = [pair.newAdopter, pair.existingAdopter].find(s => s.id === 'rosa')!;
        expect(rosa.households ?? []).toEqual([]);
        expect(rosa.isMinor).toBeFalsy();
    });
});

describe('final fix P6 — «¿Es este perfil?» counts alerts as the household line does', () => {
    it('two open inaccuracy reports → 2 (not the 0/1 per kind of the search flags)', async () => {
        sqlite.prepare(`INSERT INTO adopter_flags (id, adopter_id, flagged_by, reason) VALUES ('f2', 'pedro', ?, 'inaccurate_information')`).run(ADMIN);
        const { results } = await getHouseholdMatchCandidates({ name: 'Pedro Paez', contactEntries: [{ type: 'phone', value: HOME_PHONE }] });
        const pedro = results.find(r => r.adopterId === 'pedro')!;
        expect(pedro.openAlerts).toBe(2);
        const line = (await householdLinesFor(db(), OWNER, ['marta'])).marta.find(l => l.profileId === 'pedro')!;
        expect(line.openAlerts).toBe(pedro.openAlerts);
    });
});
