/**
 * Households as profiles, Task 4 — the paths where nobody can answer «¿Es
 * este perfil?»: the public adoption form, POST /api/adopters (post
 * importer), the interview, API v1's householdNames, and the gift recipient
 * (form data on the giver; «Crear perfil» makes the profile). Real SQL (every
 * drizzle/*.sql replayed), the real token index (tokenizeAdopter), the real
 * exact matcher (findIdentifierHits + decideExactOutcome) and the real
 * duplicate engine.
 * OWNER (team: MATE) owns the form link and Pedro; OTHER owns Marta.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { session, OWNER, MATE, STRANGER, ADMIN } = mocks;
const OTHER = 'other-rescuer@example.com';

const { state, notify, deferred, faults } = vi.hoisted(() => ({
    deferred: { on: false, tasks: [] as Array<{ name: string; task: () => Promise<unknown> }> },
    faults: {
        beforeAdd: null as null | ((input: { householdId: string; sourceKey?: string | null }) => void | Promise<void>),
        /** Runs before the next runBatch (once): another request finishing in between. */
        beforeBatch: null as null | (() => Promise<void>),
        /** Runs after the next source-key read that finds a row (once). */
        afterKeyRead: null as null | ((row: { id: string; adopterId: string; householdId: string }) => Promise<void>),
    },
    state: { db: null as unknown },
    notify: { create: [] as Array<Record<string, unknown>>, admins: [] as Array<Record<string, unknown>> },
}));

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
    getFeatureFlag: vi.fn(async (flag: string) => flag === 'ENABLE_PII_ACCESS_GATING'),
}));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/r2', () => ({ processImageForStorage: vi.fn(), uploadToR2: vi.fn() }));
// Inline by default; `deferred.on` holds the tasks back (what runs after the response).
vi.mock('@/lib/background', () => ({
    runAfterResponse: vi.fn(async (name: string, task: () => Promise<unknown>) => {
        if (deferred.on) { deferred.tasks.push({ name, task }); return; }
        await task();
    }),
}));
// A racing run landing its membership between our source-key lookup and our insert.
vi.mock('@/lib/households', async (orig) => {
    const real = await orig<typeof import('@/lib/households')>();
    return {
        ...real,
        addMembership: vi.fn(async (...args: Parameters<typeof real.addMembership>) => {
            const hook = faults.beforeAdd; faults.beforeAdd = null; await hook?.(args[1]);
            return real.addMembership(...args);
        }),
        membershipBySourceKey: vi.fn(async (...args: Parameters<typeof real.membershipBySourceKey>) => {
            const row = await real.membershipBySourceKey(...args);
            if (row && faults.afterKeyRead) { const hook = faults.afterKeyRead; faults.afterKeyRead = null; await hook(row); }
            return row;
        }),
    };
});
vi.mock('@/lib/dbBatch', async (orig) => {
    const real = await orig<typeof import('@/lib/dbBatch')>();
    return {
        ...real,
        runBatch: vi.fn(async (...args: Parameters<typeof real.runBatch>) => {
            const hook = faults.beforeBatch; faults.beforeBatch = null; await hook?.();
            return real.runBatch(...args);
        }),
    };
});
vi.mock('@/app/actions/findAdopters', async (orig) => {
    const real = await orig<typeof import('@/app/actions/findAdopters')>();
    return { ...real, findAdopters: vi.fn(real.findAdopters) };
});
vi.mock('@/app/actions/notifications', () => ({
    createNotification: vi.fn(async (d: Record<string, unknown>) => { notify.create.push(d); return 'n'; }),
    notifyAdmins: vi.fn(async (d: Record<string, unknown>) => { notify.admins.push(d); }),
    notifyOrgMembers: vi.fn(async () => undefined),
    resolveDisplayName: vi.fn(async (email: string) => email.split('@')[0]),
    resolveDisplayNames: vi.fn(async (emails: string[]) => Object.fromEntries(emails.map(e => [e, e.split('@')[0]]))),
}));
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
    withTrace: (_op: string, fn: () => unknown) => fn(),
}));

import { POST as submitForm } from '@/app/api/form/[userId]/submit/route';
import { POST as createAdopterApi } from '@/app/api/adopters/route';
import { attachHouseholdPeople, createGiftRecipientFromForm, resolveHouseholdPerson, giftRecipientsForViewer } from './householdPeople';
import { giftPhoneEntriesByGiver, giftRecipientTokenEntries, giftRecipientsOf } from './giftRecipients';
import { createGiftRecipientProfile } from '@/app/actions/households';
import { tokenizeAdopter } from './adopterTokenize';
import { findIdentifierHits } from './api/profiles';
import { addMembership, ensureHousehold } from './households';
import { households as householdsTable } from '@/db/schema';
import { addHouseholdPerson } from '@/app/actions/households';
import { logger } from '@/lib/logger';
import { findAdopters } from '@/app/actions/findAdopters';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };
const db = () => state.db as Parameters<typeof attachHouseholdPeople>[0];

const MARTA_PHONE_STORED = '+54 9 11 4444 0303';
const MARTA_PHONE_TYPED = '11 4444-0303';

const profileNamed = (name: string) => sqlite.prepare('SELECT * FROM adopters WHERE name = ? AND deleted_at IS NULL').all(name);
const membershipsOf = (adopterId: string) => sqlite.prepare('SELECT * FROM household_memberships WHERE adopter_id = ? ORDER BY added_at, id').all(adopterId);
const householdOf = (householdId: string) => sqlite.prepare('SELECT * FROM household_memberships WHERE household_id = ? ORDER BY added_at, id').all(householdId);
const count = (sql: string, ...a: unknown[]) => sqlite.prepare(sql).get(...a)!.n as number;
const tokensOf = (adopterId: string) => sqlite.prepare('SELECT token_type, token_value FROM duplicate_tokens WHERE adopter_id = ?').all(adopterId);
const historyOf = (adopterId: string) => sqlite.prepare('SELECT changed_by, kind, changes FROM adopter_history WHERE adopter_id = ? ORDER BY rowid').all(adopterId)
    .map(r => ({ ...r, changes: JSON.parse(r.changes as string) }));

async function postForm(body: Record<string, unknown>) {
    const res = await submitForm(new Request('http://localhost/api/form/u-owner/submit', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ userId: 'u-owner' }) });
    const json = await res.json() as { submissionId?: string; error?: string };
    expect(res.status, JSON.stringify(json)).toBe(200);
    const row = sqlite.prepare('SELECT * FROM form_submissions WHERE id = ?').get(json.submissionId)!;
    return { submissionId: json.submissionId!, applicantId: row.linked_adopter_id as string };
}

async function postAdopter(body: Record<string, unknown>) {
    const res = await createAdopterApi(new Request('http://localhost/api/adopters', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }));
    const json = await res.json() as { id?: string; error?: string };
    expect(res.status, JSON.stringify(json)).toBeLessThan(300);
    return json.id!;
}

beforeEach(async () => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    notify.create.length = 0;
    notify.admins.length = 0;
    deferred.on = false;
    deferred.tasks.length = 0;
    faults.beforeAdd = null;
    faults.beforeBatch = null;
    faults.afterKeyRead = null;
    vi.mocked(findAdopters).mockClear();
    session.user = OWNER;
    // The form link's owner, in Argentina: phones are read as Argentine ones.
    sqlite.prepare(`INSERT INTO user (id, email, name) VALUES ('u-owner', ?, 'Owner')`).run(OWNER);
    sqlite.prepare(`INSERT INTO user_profiles (user_id, country) VALUES ('u-owner', 'AR')`).run();
    const insert = sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, country, created_at, updated_at, contact_entries) VALUES (?, ?, '5', ?, 'AR', 1000, 1000, ?)`);
    insert.run('pedro', 'Pedro Paez', OWNER, JSON.stringify([{ id: 'pc', type: 'phone', value: '+54 9 11 6123 4455', addedBy: OWNER }]));
    insert.run('marta', 'Marta Paez', OTHER, JSON.stringify([{ id: 'mc', type: 'phone', value: MARTA_PHONE_STORED, addedBy: OTHER }]));
    await tokenizeAdopter('pedro');
    await tokenizeAdopter('marta');
});

describe('the adoption form', () => {
    it('two named people → two profiles (owned by the form owner) in ONE household with the applicant; no JSON', async () => {
        const { submissionId, applicantId } = await postForm({
            name: 'Juan López', email: 'juan@example.com', phone: '11 2222 3333', intent: 'self',
            householdPeople: [
                { relationship: 'child', age: 3, firstName: 'Tomás', lastName: 'López' },
                { relationship: 'child', age: 11 },
                { relationship: 'partner', age: 38, firstName: 'Laura', lastName: 'Gómez' },
            ],
            livesAlone: false,
        });
        expect(applicantId).toBeTruthy();
        const applicant = sqlite.prepare('SELECT household_members FROM adopters WHERE id = ?').get(applicantId)!;
        expect(applicant.household_members).toBeNull();

        const [tomas] = profileNamed('Tomás López');
        const [laura] = profileNamed('Laura Gómez');
        expect(tomas).toMatchObject({ added_by: OWNER, age: 3, is_minor: 1, is_public: 0, household_members: null });
        expect(laura).toMatchObject({ added_by: OWNER, age: 38, is_minor: 0 });

        const mine = membershipsOf(applicantId);
        expect(mine).toHaveLength(1);
        const members = householdOf(mine[0].household_id as string);
        expect(members.map(m => m.adopter_id)).toEqual([applicantId, tomas.id, laura.id]);
        expect(members[0]).toMatchObject({ relative_to_adopter_id: null, added_by: null });
        expect(members[1]).toMatchObject({ relationship: 'child', relative_to_adopter_id: applicantId, added_by: 'form-submission', source_key: `form-${submissionId}-0` });
        expect(members[2]).toMatchObject({ relationship: 'partner', source_key: `form-${submissionId}-2` });

        // History on the applicant, the creation line on the member.
        expect(historyOf(applicantId).map(h => Object.keys(h.changes)[0])).toEqual(expect.arrayContaining(['auto_created_from_form', 'household_member_added']));
        expect(historyOf(tomas.id as string)[0].changes).toEqual({ created_in_household: expect.objectContaining({ anchorId: applicantId, via: 'form', gift: false }) });
        // Never a duplicate candidate of the person they live with (spec anti-goal).
        expect(count(`SELECT COUNT(*) AS n FROM duplicate_candidates WHERE adopter1_id IN (?, ?) AND adopter2_id IN (?, ?)`, applicantId, tomas.id, applicantId, tomas.id)).toBe(0);
    });

    it('the same submission attached again (a replay) creates no new profile or membership', async () => {
        const { submissionId, applicantId } = await postForm({
            name: 'Ana Ruiz', email: 'ana@example.com', phone: '11 2222 4444', intent: 'self',
            householdPeople: [{ relationship: 'partner', age: 40, firstName: 'Luis', lastName: 'Ruiz' }], livesAlone: false,
        });
        const before = count('SELECT COUNT(*) AS n FROM adopters');
        const res = await attachHouseholdPeople(db(), {
            anchorAdopterId: applicantId, people: [{ name: 'Luis Ruiz', relationship: 'partner', age: 40, index: 0 }],
            actor: 'form-submission', ownerEmail: OWNER, sourceKey: `form-${submissionId}`,
        });
        expect(res.created).toEqual([]);
        expect(res.reused).toHaveLength(1);
        expect(count('SELECT COUNT(*) AS n FROM adopters')).toBe(before);
        expect(profileNamed('Luis Ruiz')).toHaveLength(1);
        expect(count('SELECT COUNT(*) AS n FROM household_memberships WHERE adopter_id = ?', res.reused[0])).toBe(1);
    });

    it('gift: NO profile and no household — the giver\'s profile reads the recipient from the form, and the phone finds the giver', async () => {
        const { submissionId, applicantId } = await postForm({
            name: 'Jonathan Giver', email: 'jg@example.com', phone: '11 6123 9999', intent: 'gift',
            giftRecipient: { relationship: 'child', firstName: 'Sofía', lastName: 'Gómez', phone: '11 5555 0101' },
            householdPeople: [{ relationship: 'partner', age: 30, firstName: 'Marcos', lastName: 'Gómez' }], livesAlone: false,
        });
        expect(profileNamed('Sofía Gómez')).toHaveLength(0);
        expect(profileNamed('Marcos Gómez')).toHaveLength(0); // the recipient's home, never the giver's household
        expect(count('SELECT COUNT(*) AS n FROM household_memberships')).toBe(0);
        expect(sqlite.prepare('SELECT household_members FROM adopters WHERE id = ?').get(applicantId)!.household_members).toBeNull();

        expect(await giftRecipientsOf(db(), applicantId)).toEqual([
            expect.objectContaining({ submissionId, name: 'Sofía Gómez', relationship: 'child', phone: '11 5555 0101', profileId: null }),
        ]);
        // Searching that phone finds the giver, as before (its tokens hold it).
        const hits = await findIdentifierHits(db(), { fullName: 'Jonathan Giver', phone: '11 5555 0101' }, 'r', 'AR');
        expect(hits.candidates.map(c => c.profileId)).toEqual([applicantId]);
        // The admin rescan reads the same entries in one query per batch.
        expect((await giftPhoneEntriesByGiver(db())).get(applicantId)).toEqual(await giftRecipientTokenEntries(db(), applicantId));
        // …and survives a re-index.
        await tokenizeAdopter(applicantId, { force: true });
        expect(tokensOf(applicantId).some(t => String(t.token_value).includes('55550101'))).toBe(true);
    });

    it('gift with a first-name-only recipient: nothing on the profile', async () => {
        const { applicantId } = await postForm({
            name: 'Otro Giver', email: 'og@example.com', phone: '11 6123 8888', intent: 'gift',
            giftRecipient: { relationship: 'sibling', firstName: 'Ana', phone: '11 5555 0202' },
        });
        expect(await giftRecipientsOf(db(), applicantId)).toEqual([]);
    });
});

describe('createGiftRecipientProfile («Crear perfil de {nombre}»)', () => {
    async function giftForm() {
        return await postForm({
            name: 'Jonathan Giver', email: 'jg2@example.com', phone: '11 6123 7777', intent: 'gift',
            giftRecipient: { relationship: 'child', firstName: 'Sofía', lastName: 'Gómez', phone: '11 5555 0101' },
        });
    }

    it("the giver's team makes it: owner = the giver's owner, the phone credited to the form, a gift household (recipient first); once", async () => {
        const { submissionId, applicantId } = await giftForm();
        session.user = MATE;
        const res = await createGiftRecipientProfile({ giverAdopterId: applicantId, submissionId });
        if (!res.ok) throw new Error(res.error);
        expect(res.created).toBe(true);
        const sofia = sqlite.prepare('SELECT * FROM adopters WHERE id = ?').get(res.profileId)!;
        expect(sofia).toMatchObject({ name: 'Sofía Gómez', added_by: OWNER, is_public: 0 });
        expect(JSON.parse(sofia.contact_entries as string)).toEqual([expect.objectContaining({ type: 'phone', value: '11 5555 0101', addedBy: 'form-submission' })]);
        const members = householdOf(res.householdId);
        expect(members.map(m => [m.adopter_id, m.gift_recipient, m.added_by])).toEqual([[res.profileId, 1, MATE], [applicantId, 0, null]]);
        expect(members[0]).toMatchObject({ relative_to_adopter_id: applicantId, relationship: 'child', source_key: `gift-${submissionId}` });
        expect(await giftRecipientsOf(db(), applicantId)).toEqual([expect.objectContaining({ profileId: res.profileId })]);

        // A second click: the same profile, nothing new.
        const again = await createGiftRecipientProfile({ giverAdopterId: applicantId, submissionId });
        expect(again).toMatchObject({ ok: true, profileId: res.profileId, created: false });
        expect(profileNamed('Sofía Gómez')).toHaveLength(1);
        // Two at once: still one.
        const { submissionId: s2, applicantId: g2 } = await postForm({
            name: 'Second Giver', email: 'sg@example.com', phone: '11 6123 6666', intent: 'gift',
            giftRecipient: { relationship: 'parent', firstName: 'Rita', lastName: 'Sosa' },
        });
        session.user = OWNER;
        const both = await Promise.all([createGiftRecipientProfile({ giverAdopterId: g2, submissionId: s2 }), createGiftRecipientProfile({ giverAdopterId: g2, submissionId: s2 })]);
        expect(both.filter(r => r.ok).length).toBeGreaterThanOrEqual(1);
        expect(profileNamed('Rita Sosa')).toHaveLength(1);
    });

    it('a stranger is refused; an admin may; a form of another profile is not_found', async () => {
        const { submissionId, applicantId } = await giftForm();
        session.user = STRANGER;
        expect(await createGiftRecipientProfile({ giverAdopterId: applicantId, submissionId })).toEqual({ ok: false, error: 'not_authorized' });
        session.user = OWNER;
        expect(await createGiftRecipientProfile({ giverAdopterId: 'pedro', submissionId })).toEqual({ ok: false, error: 'not_found' });
        session.user = ADMIN;
        expect(await createGiftRecipientProfile({ giverAdopterId: applicantId, submissionId })).toMatchObject({ ok: true, created: true });
    });

    it("the giver's block is masked for a stranger exactly as the household members were", async () => {
        const { applicantId } = await giftForm();
        const [owner] = await giftRecipientsForViewer(db(), OWNER, applicantId);
        expect(owner).toMatchObject({ name: 'Sofía Gómez', phone: '11 5555 0101', masked: false });
        const [stranger] = await giftRecipientsForViewer(db(), STRANGER, applicantId);
        expect(stranger.masked).toBe(true);
        expect(stranger.name).not.toBe('Sofía Gómez');
        expect(stranger.phone ?? '').not.toContain('5555 0101');
    });
});

describe('the exact match (API exact mode)', () => {
    it('a phone + a name that fits exactly one profile → that profile joins (phone read with the owner\'s country)', async () => {
        const id = await postAdopter({
            name: 'Lucas Paez', contactInfo: '+54 9 11 7777 1111',
            householdMembers: JSON.stringify([{ id: 'x', name: 'Marta Paez', relationship: 'partner', contactEntries: [{ id: 'c', type: 'phone', value: MARTA_PHONE_TYPED }] }]),
        });
        expect(profileNamed('Marta Paez')).toHaveLength(1);
        const members = householdOf(membershipsOf(id)[0].household_id as string);
        expect(members.map(m => m.adopter_id)).toEqual([id, 'marta']);
        expect(members[1]).toMatchObject({ relationship: 'partner', added_by: OWNER, source_key: `import:${id}-0` });
        expect(sqlite.prepare('SELECT household_members FROM adopters WHERE id = ?').get(id)!.household_members).toBeNull();
        // Marta's history says she joined; her owner (another team) hears about it.
        expect(historyOf('marta').map(h => Object.keys(h.changes)[0])).toContain('household_joined');
        expect(notify.create.some(n => n.userId === OTHER)).toBe(true);
    });

    it('the phone matches but the name does not fit → a new profile', async () => {
        const id = await postAdopter({
            name: 'Lucas Paez',
            householdMembers: JSON.stringify([{ id: 'x', name: 'Rosa Díaz', relationship: 'sibling', contactEntries: [{ id: 'c', type: 'phone', value: MARTA_PHONE_TYPED }] }]),
        });
        const [rosa] = profileNamed('Rosa Díaz');
        expect(rosa).toMatchObject({ added_by: OWNER });
        expect(JSON.parse(rosa.contact_entries as string)).toEqual([expect.objectContaining({ type: 'phone', value: MARTA_PHONE_TYPED, addedBy: OWNER })]);
        expect(householdOf(membershipsOf(id)[0].household_id as string).map(m => m.adopter_id)).toEqual([id, rosa.id]);
        expect(membershipsOf('marta')).toHaveLength(0);
    });

    it('a new profile\'s likely duplicates go to «Pendientes de revisar» — never the person it lives with', async () => {
        const id = await postAdopter({
            name: 'Lucas Paez', contactEntries: JSON.stringify([{ id: 'lp', type: 'phone', value: '11 7777 2222' }]),
            householdMembers: JSON.stringify([
                // Shares the anchor's phone, another name: a new profile, never paired with Lucas.
                { id: 'x', name: 'Rosa Paez', relationship: 'sibling', contactEntries: [{ id: 'c1', type: 'phone', value: '11 7777 2222' }] },
                // Marta's phone under a name that doesn't fit: a new profile, paired with Marta for review.
                { id: 'y', name: 'Marta Gomez', relationship: 'partner', contactEntries: [{ id: 'c2', type: 'phone', value: MARTA_PHONE_TYPED }] },
            ]),
        });
        const [rosa] = profileNamed('Rosa Paez');
        const [other] = profileNamed('Marta Gomez');
        const pairs = sqlite.prepare('SELECT adopter1_id AS a, adopter2_id AS b, status FROM duplicate_candidates').all();
        const has = (x: unknown, y: unknown) => pairs.some(p => (p.a === x && p.b === y) || (p.a === y && p.b === x));
        expect(has(rosa.id, id)).toBe(false);
        expect(has(rosa.id, other.id)).toBe(false);
        expect(has(other.id, 'marta')).toBe(true);
    });

    it('a housemate\'s name on a profile\'s phone is NOT that profile (no household_member reuse)', async () => {
        const hh = await ensureHousehold(db(), 'pedro', null);
        await addMembership(db(), { householdId: hh, adopterId: 'marta', relationship: 'partner', relativeToAdopterId: 'pedro', addedBy: OWNER });
        // The identifier finds Pedro alone, matched on his own names only (no household_member)…
        const hits = await findIdentifierHits(db(), { fullName: 'Marta Paez', phone: '11 6123 4455' }, 'r', 'AR');
        expect(hits.candidates).toEqual([{ profileId: 'pedro', name: 'Pedro Paez', aliases: [] }]);
        // …but Pedro's phone with Marta's name never resolves to Pedro.
        expect(await resolveHouseholdPerson(db(), { name: 'Marta Paez', phone: '11 6123 4455' }, 'AR', 'r')).toBeNull();
        expect(await resolveHouseholdPerson(db(), { name: 'Marta Paez', phone: MARTA_PHONE_TYPED }, 'AR', 'r')).toEqual({ profileId: 'marta' });
        // A one-word name or no identifier: no lookup.
        expect(await resolveHouseholdPerson(db(), { name: 'Marta', phone: MARTA_PHONE_TYPED }, 'AR', 'r')).toBeNull();
        expect(await resolveHouseholdPerson(db(), { name: 'Marta Paez' }, 'AR', 'r')).toBeNull();
    });

    it("the anchor's own phone and name are not added as their housemate", async () => {
        const res = await attachHouseholdPeople(db(), {
            anchorAdopterId: 'pedro', actor: OWNER, ownerEmail: OWNER, sourceKey: 'import:t',
            people: [{ name: 'Pedro Paez', relationship: 'unknown', contactEntries: [{ id: 'c', type: 'phone', value: '11 6123 4455', addedBy: OWNER }] }],
        });
        expect(res.skipped).toEqual([{ index: 0, reason: 'same_as_anchor' }]);
        expect(count('SELECT COUNT(*) AS n FROM household_memberships')).toBe(0);
    });

    it('a gift recipient\'s profile is never part of the giver\'s exact match', async () => {
        const { submissionId, applicantId } = await postForm({
            name: 'Jonathan Giver', email: 'jg3@example.com', phone: '11 6123 5555', intent: 'gift',
            giftRecipient: { relationship: 'child', firstName: 'Sofía', lastName: 'Gómez', phone: '11 5555 0101' },
        });
        const made = await createGiftRecipientProfile({ giverAdopterId: applicantId, submissionId });
        expect(made.ok).toBe(true);
        const hits = await findIdentifierHits(db(), { fullName: 'Jonathan Giver', phone: '11 6123 5555' }, 'r', 'AR');
        expect(hits.candidates).toEqual([{ profileId: applicantId, name: 'Jonathan Giver', aliases: [] }]);
    });
});

describe('the interview (same add path, by name within that household)', () => {
    it('additions become memberships; the same name is never added twice to that household, a retry adds nothing', async () => {
        const first = await attachHouseholdPeople(db(), {
            anchorAdopterId: 'pedro', actor: OWNER, ownerEmail: OWNER, sourceKey: 'interview:i1',
            people: [{ name: 'Ana', relationship: 'partner', index: 0 }, { name: 'Beto Paez', relationship: 'child', index: 2 }],
        });
        expect(first.created).toHaveLength(2);
        // Another interview names "ana" again, plus someone new.
        const second = await attachHouseholdPeople(db(), {
            anchorAdopterId: 'pedro', actor: OWNER, ownerEmail: OWNER, sourceKey: 'interview:i2',
            people: [{ name: ' ána ', relationship: 'partner' }, { name: 'Ceci Paez', relationship: 'child' }],
        });
        expect(second.created).toHaveLength(1);
        expect(second.skipped).toEqual([{ index: 0, reason: 'same_name_in_household' }]);
        // A retry of the first interview: nothing new.
        const retry = await attachHouseholdPeople(db(), {
            anchorAdopterId: 'pedro', actor: OWNER, ownerEmail: OWNER, sourceKey: 'interview:i1',
            people: [{ name: 'Ana', relationship: 'partner', index: 0 }, { name: 'Beto Paez', relationship: 'child', index: 2 }],
        });
        expect(retry.created).toEqual([]);
        const hh = membershipsOf('pedro')[0].household_id as string;
        expect(householdOf(hh).map(m => m.source_key)).toEqual([null, 'interview:i1-0', 'interview:i1-2', 'interview:i2-1']);
        expect(sqlite.prepare("SELECT household_members FROM adopters WHERE id = 'pedro'").get()!.household_members).toBeNull();
    });
});

describe('POST /api/adopters (post importer)', () => {
    it('householdMembers JSON → profiles + memberships, no JSON stored, never a planted profileId', async () => {
        const id = await postAdopter({
            name: 'Pedro Prueba',
            householdMembers: JSON.stringify([
                { id: 'x', name: 'Laura Prueba', relationship: 'partner', own: true, contactEntries: [{ id: 'c1', type: 'social', value: 'instagram.com/lauraprueba', own: true }] },
                { id: 'y', name: 'Jonathan Urfalino', relationship: 'sibling', contactEntries: [], profileId: 'marta' },
            ]),
        });
        expect(sqlite.prepare('SELECT household_members FROM adopters WHERE id = ?').get(id)!.household_members).toBeNull();
        const [laura] = profileNamed('Laura Prueba');
        expect(laura.contact_entries as string).toContain('lauraprueba');
        expect(laura.contact_entries as string).not.toContain('"own"');
        const members = householdOf(membershipsOf(id)[0].household_id as string);
        expect(members).toHaveLength(3);
        expect(members.map(m => m.adopter_id)).not.toContain('marta');
        expect(count('SELECT COUNT(*) AS n FROM household_links')).toBe(0);
        // A private import: the relatives are protected like their host.
        expect(laura.is_public).toBe(0);
    });

    it("a public post's relatives are «público» like their host (they were readable as its JSON before)", async () => {
        const id = await postAdopter({
            name: 'Pedro Publico', source: 'imported', sourceUrl: 'https://facebook.com/posts/1',
            householdMembers: JSON.stringify([{ id: 'x', name: 'Laura Publica', relationship: 'partner', contactEntries: [{ id: 'c1', type: 'phone', value: '11 3333 4444' }] }]),
        });
        expect(sqlite.prepare('SELECT is_public FROM adopters WHERE id = ?').get(id)!.is_public).toBe(1);
        const [laura] = profileNamed('Laura Publica');
        expect(laura.is_public).toBe(1);
        expect(laura.contact_entries as string).not.toContain('isPublic'); // never stamped per entry (the host's members weren't)
    });
});

describe('Task 4 fix round 1', () => {
    const live = (name: string) => count('SELECT COUNT(*) AS n FROM adopters WHERE name = ? AND deleted_at IS NULL', name);

    it('I1: two runs with the same source key at once → one person, one membership', async () => {
        const run = () => attachHouseholdPeople(db(), {
            anchorAdopterId: 'pedro', actor: OWNER, ownerEmail: OWNER, sourceKey: 'interview:race',
            people: [{ name: 'Ana López', relationship: 'partner', index: 0 }],
        });
        const [a, b] = await Promise.all([run(), run()]);
        expect(live('Ana López')).toBe(1);
        expect(count(`SELECT COUNT(*) AS n FROM household_memberships WHERE source_key = 'interview:race-0'`)).toBe(1);
        expect([...a.created, ...b.created]).toHaveLength(1);
        expect([...a.reused, ...b.reused]).toHaveLength(1);
        expect([...a.skipped, ...b.skipped]).toEqual([]);
    });

    it('I1: a run that loses the source key to a racing run reuses the winner\'s person and drops its own profile', async () => {
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('winner', 'Ana López', '5', ?, 1, 1)`).run(OWNER);
        faults.beforeAdd = (m) => {
            sqlite.prepare(`INSERT INTO household_memberships (id, household_id, adopter_id, relationship, relative_to_adopter_id, added_by, added_at, source_key) VALUES ('hm-winner', ?, 'winner', 'partner', 'pedro', ?, 1, ?)`)
                .run(m.householdId, OWNER, m.sourceKey);
        };
        vi.mocked(logger.error).mockClear();
        const res = await attachHouseholdPeople(db(), {
            anchorAdopterId: 'pedro', actor: OWNER, ownerEmail: OWNER, sourceKey: 'interview:lost',
            people: [{ name: 'Ana López', relationship: 'partner', index: 0 }],
        });
        expect(res).toMatchObject({ created: [], reused: ['winner'], skipped: [] });
        expect(live('Ana López')).toBe(1);
        expect(count(`SELECT COUNT(*) AS n FROM household_memberships WHERE source_key = 'interview:lost-0'`)).toBe(1);
        expect(vi.mocked(logger.error)).not.toHaveBeenCalled();
    });

    it('I1: the source key is unique in the database (0098)', () => {
        const hh = 'hh-x';
        sqlite.prepare(`INSERT INTO households (id, created_at) VALUES (?, 1)`).run(hh);
        sqlite.prepare(`INSERT INTO household_memberships (id, household_id, adopter_id, added_at, source_key) VALUES ('m1', ?, 'pedro', 1, 'k-1')`).run(hh);
        expect(() => sqlite.prepare(`INSERT INTO household_memberships (id, household_id, adopter_id, added_at, source_key) VALUES ('m2', ?, 'marta', 1, 'k-1')`).run(hh)).toThrow(/UNIQUE/);
        // NULL keys never collide.
        sqlite.prepare(`INSERT INTO household_memberships (id, household_id, adopter_id, added_at) VALUES ('m3', ?, 'marta', 1)`).run(hh);
    });

    it('I2: re-merging the same post adds its relatives once (source key per post + slot, and the household name rule)', async () => {
        const add = () => addHouseholdPerson({
            anchorAdopterId: 'pedro', name: 'Laura Paez', relationship: 'partner',
            contactEntries: [{ type: 'social', value: 'instagram.com/laurapaez' }],
            fromImport: { sourceUrl: 'https://facebook.com/posts/9', slot: 'r0' },
        });
        const first = await add();
        const second = await add();
        expect(first).toMatchObject({ ok: true, createdProfile: true });
        expect(second).toMatchObject({ ok: true, createdProfile: false });
        if (first.ok && second.ok) expect(second.profileId).toBe(first.profileId);
        expect(live('Laura Paez')).toBe(1);
        // Another post naming the same person (same household, same name) adds nobody.
        const other = await addHouseholdPerson({ anchorAdopterId: 'pedro', name: 'laura  PÁEZ', relationship: 'partner', fromImport: { sourceUrl: null, slot: 'r0' } });
        expect(other).toMatchObject({ ok: true, createdProfile: false });
        expect(live('Laura Paez') + live('laura  PÁEZ')).toBe(1);
        const keys = sqlite.prepare(`SELECT source_key FROM household_memberships WHERE source_key IS NOT NULL`).all().map(r => String(r.source_key));
        expect(keys).toHaveLength(1);
        expect(keys[0]).toMatch(/^import-post:[0-9a-f]{16}-r0$/);
    });

    it('gift: a soft-deleted recipient profile is absent — «Crear perfil» works again', async () => {
        const { submissionId, applicantId } = await postForm({
            name: 'Jonathan Giver', email: 'jg9@example.com', phone: '11 6123 1212', intent: 'gift',
            giftRecipient: { relationship: 'child', firstName: 'Sofía', lastName: 'Gómez', phone: '11 5555 0101' },
        });
        const first = await createGiftRecipientProfile({ giverAdopterId: applicantId, submissionId });
        if (!first.ok) throw new Error(first.error);
        sqlite.prepare('UPDATE adopters SET deleted_at = 5 WHERE id = ?').run(first.profileId);
        const again = await createGiftRecipientProfile({ giverAdopterId: applicantId, submissionId });
        expect(again).toMatchObject({ ok: true, created: true });
        if (again.ok) expect(again.profileId).not.toBe(first.profileId);
        expect(live('Sofía Gómez')).toBe(1);
        expect(count(`SELECT COUNT(*) AS n FROM household_memberships WHERE source_key = ?`, `gift-${submissionId}`)).toBe(1);
    });

    it('gift: two requests taking over an abandoned claim at once → one profile, nobody deletes the winner', async () => {
        const { submissionId, applicantId } = await postForm({
            name: 'Jonathan Giver', email: 'jg8@example.com', phone: '11 6123 1313', intent: 'gift',
            giftRecipient: { relationship: 'child', firstName: 'Paula', lastName: 'Ríos' },
        });
        // A request that crashed right after claiming, long ago.
        sqlite.prepare(`INSERT INTO households (id, created_by, created_at) VALUES (?, ?, 1000)`).run(`hh-gift-${submissionId}`, OWNER);
        const both = await Promise.all([
            createGiftRecipientProfile({ giverAdopterId: applicantId, submissionId }),
            createGiftRecipientProfile({ giverAdopterId: applicantId, submissionId }),
        ]);
        expect(both.filter(r => r.ok && r.created)).toHaveLength(1);
        expect(live('Paula Ríos')).toBe(1);
        const members = householdOf(`hh-gift-${submissionId}`);
        expect(members.map(m => m.gift_recipient)).toEqual([1, 0]);
    });

    it('public form: household people are indexed and scanned after the response; name-only ones skip the LIKE fallback', async () => {
        deferred.on = true;
        await postForm({
            name: 'Juan Diferido', email: 'jd@example.com', phone: '11 2222 5555', intent: 'self',
            householdPeople: [{ relationship: 'child', age: 5, firstName: 'Tomás', lastName: 'Diferido' }], livesAlone: false,
        });
        const [tomas] = profileNamed('Tomás Diferido');
        // Placed now, indexed later.
        expect(membershipsOf(tomas.id as string)).toHaveLength(1);
        expect(tokensOf(tomas.id as string)).toEqual([]);
        expect(deferred.tasks.map(t => t.name)).toContain('attachHouseholdPeople.index');
        for (const t of deferred.tasks) await t.task();
        expect(tokensOf(tomas.id as string).length).toBeGreaterThan(0);
        const scan = vi.mocked(findAdopters).mock.calls.find(c => (c[0] as { excludeAdopterId?: string }).excludeAdopterId === tomas.id);
        expect(scan?.[1]).toMatchObject({ mode: 'duplicate', skipLikeFallback: true });
    });

    it('housemates never crowd a real duplicate out of the candidate slots', async () => {
        const P = '11 4545 6767';
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, country, created_at, updated_at, contact_entries) VALUES ('outsider', 'Rita Sosa', '5', ?, 'AR', 1000, 1000, ?)`)
            .run(OTHER, JSON.stringify([{ id: 'oc', type: 'phone', value: P, addedBy: OTHER }]));
        await tokenizeAdopter('outsider');
        const names = ['Ana Gomez', 'Bea Gomez', 'Ceci Gomez', 'Dora Gomez', 'Eva Gomez', 'Fede Gomez'];
        await attachHouseholdPeople(db(), {
            anchorAdopterId: 'pedro', actor: OWNER, ownerEmail: OWNER, sourceKey: 'import:crowd',
            people: names.map((name, i) => ({ name, relationship: 'housemate', index: i, contactEntries: [{ id: `c${i}`, type: 'phone' as const, value: P, addedBy: OWNER }] })),
        });
        const res = await attachHouseholdPeople(db(), {
            anchorAdopterId: 'pedro', actor: OWNER, ownerEmail: OWNER, sourceKey: 'import:crowd2',
            people: [{ name: 'Zoe Gomez', relationship: 'housemate', contactEntries: [{ id: 'z', type: 'phone', value: P, addedBy: OWNER }] }],
        });
        const zoe = res.created[0];
        const pairs = sqlite.prepare('SELECT adopter1_id AS a, adopter2_id AS b FROM duplicate_candidates').all();
        expect(pairs.some(p => (p.a === zoe && p.b === 'outsider') || (p.b === zoe && p.a === 'outsider'))).toBe(true);
        const housemates = new Set(membershipsOf('pedro').length ? sqlite.prepare(`SELECT adopter_id FROM household_memberships WHERE household_id = 'hh-pedro'`).all().map(r => r.adopter_id) : []);
        expect(pairs.some(p => (p.a === zoe && housemates.has(p.b)) || (p.b === zoe && housemates.has(p.a)))).toBe(false);
    });
});

describe('Task 4 fix round 2', () => {
    const live = (name: string) => count('SELECT COUNT(*) AS n FROM adopters WHERE name = ? AND deleted_at IS NULL', name);
    async function giftWithDeletedRecipient(email: string) {
        const { submissionId, applicantId } = await postForm({
            name: 'Jonathan Giver', email, phone: '11 6123 2424', intent: 'gift',
            giftRecipient: { relationship: 'child', firstName: 'Sofía', lastName: 'Gómez', phone: '11 5555 0101' },
        });
        const first = await createGiftRecipientProfile({ giverAdopterId: applicantId, submissionId });
        if (!first.ok) throw new Error(first.error);
        sqlite.prepare('UPDATE adopters SET deleted_at = 5 WHERE id = ?').run(first.profileId);
        return { submissionId, applicantId };
    }

    it('gift: a request cleaning up a deleted recipient never wipes the rows a faster click just made', async () => {
        const { submissionId, applicantId } = await giftWithDeletedRecipient('jg20@example.com');
        let a: Awaited<ReturnType<typeof createGiftRecipientProfile>> | null = null;
        // B has read the stale recipient; before its cleanup lands, A makes the profile.
        faults.beforeBatch = async () => { a = await createGiftRecipientProfile({ giverAdopterId: applicantId, submissionId }); };
        const b = await createGiftRecipientProfile({ giverAdopterId: applicantId, submissionId });
        expect(a).toMatchObject({ ok: true, created: true });
        expect(live('Sofía Gómez')).toBe(1);
        const members = householdOf(`hh-gift-${submissionId}`);
        const sofia = sqlite.prepare(`SELECT id FROM adopters WHERE name = 'Sofía Gómez' AND deleted_at IS NULL`).get()!.id;
        // The new recipient replaced the deleted one next to the giver's kept row.
        expect(members.map(m => [m.adopter_id, m.gift_recipient]).sort()).toEqual([[applicantId, 0], [sofia, 1]].sort());
        if (b.ok) expect(b.profileId).toBe(sofia); else expect(b.error).toBe('conflict');
    });

    it('gift: a slow request whose abandoned claim was taken over leaves the new owner\'s rows alone', async () => {
        const { submissionId, applicantId } = await postForm({
            name: 'Jonathan Giver', email: 'jg21@example.com', phone: '11 6123 2525', intent: 'gift',
            giftRecipient: { relationship: 'child', firstName: 'Lola', lastName: 'Paz' },
        });
        let b = null as Awaited<ReturnType<typeof createGiftRecipientProfile>> | null;
        // A claimed and is about to place the recipient; it stalls past the abandon window and B takes over.
        faults.beforeAdd = async () => {
            sqlite.prepare(`UPDATE households SET created_at = 1000 WHERE id = ?`).run(`hh-gift-${submissionId}`);
            b = await createGiftRecipientProfile({ giverAdopterId: applicantId, submissionId });
        };
        const a = await createGiftRecipientProfile({ giverAdopterId: applicantId, submissionId });
        expect(b).toMatchObject({ ok: true, created: true });
        const bRes = b as unknown as { ok: true; profileId: string };
        expect(a.ok ? a.profileId : a.error).toBe(bRes.profileId);
        expect(live('Lola Paz')).toBe(1);
        expect(householdOf(`hh-gift-${submissionId}`).map(m => m.gift_recipient)).toEqual([1, 0]);
    });

    it('gift: of two requests taking over an abandoned claim, the one whose read went stale never takes it (compare-and-set)', async () => {
        const { submissionId, applicantId } = await postForm({
            name: 'Jonathan Giver', email: 'jg22@example.com', phone: '11 6123 2626', intent: 'gift',
            giftRecipient: { relationship: 'child', firstName: 'Nina', lastName: 'Vera' },
        });
        const hh = `hh-gift-${submissionId}`;
        sqlite.prepare(`INSERT INTO households (id, created_by, created_at) VALUES (?, 'crashed@example.com', 1000)`).run(hh);
        // B has read the abandoned claim; before its takeover lands, A takes it over and finishes.
        const real = db();
        let fired = false;
        const slowDb = new Proxy(real, {
            get(target, prop) {
                if (prop === 'update') {
                    return (table: unknown) => {
                        const chain = (target.update as (t: unknown) => { set: (v: unknown) => { where: (w: unknown) => { returning: (r: unknown) => Promise<unknown[]> } } })(table);
                        if (fired || table !== householdsTable) return chain;
                        fired = true;
                        return {
                            set: (v: unknown) => ({
                                where: (w: unknown) => ({
                                    returning: async (r: unknown) => {
                                        await createGiftRecipientFromForm(real, { giverAdopterId: applicantId, submissionId, actor: ADMIN });
                                        return chain.set(v).where(w).returning(r);
                                    },
                                }),
                            }),
                        };
                    };
                }
                const v = Reflect.get(target, prop);
                return typeof v === 'function' ? v.bind(target) : v;
            },
        }) as typeof real;
        const b = await createGiftRecipientFromForm(slowDb, { giverAdopterId: applicantId, submissionId, actor: OWNER });
        expect(fired).toBe(true);
        expect(b).toEqual({ ok: false, error: 'conflict' });
        // B never made a profile, and the household stays A's.
        expect(count(`SELECT COUNT(*) AS n FROM adopters WHERE name = 'Nina Vera'`)).toBe(1);
        expect(sqlite.prepare('SELECT created_by FROM households WHERE id = ?').get(hh)!.created_by).toBe(ADMIN);
        expect(householdOf(hh).map(m => m.gift_recipient)).toEqual([1, 0]);
    });

    it('addHouseholdPerson: losing the import key to a racing re-merge answers that person and drops ours', async () => {
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('winner', 'Laura Paez', '5', ?, 1, 1)`).run(OWNER);
        faults.beforeAdd = (m) => {
            sqlite.prepare(`INSERT INTO household_memberships (id, household_id, adopter_id, relationship, relative_to_adopter_id, added_by, added_at, source_key) VALUES ('hm-w', ?, 'winner', 'partner', 'pedro', ?, 1, ?)`)
                .run(m.householdId, OWNER, m.sourceKey);
        };
        const res = await addHouseholdPerson({ anchorAdopterId: 'pedro', name: 'Laura Paez', relationship: 'partner', fromImport: { sourceUrl: 'https://facebook.com/posts/77', slot: 'r0' } });
        expect(res).toMatchObject({ ok: true, profileId: 'winner', membershipId: 'hm-w', createdProfile: false });
        expect(live('Laura Paez')).toBe(1);
    });

    it("the import name rule tells a caller without standing only «already there» — never the housemate's profile", async () => {
        const hh = await ensureHousehold(db(), 'pedro', null);
        await addMembership(db(), { householdId: hh, adopterId: 'marta', relationship: 'partner', relativeToAdopterId: 'pedro', addedBy: OWNER });
        session.user = STRANGER;
        const res = await addHouseholdPerson({ anchorAdopterId: 'pedro', name: 'marta paez', relationship: 'partner', fromImport: { sourceUrl: null, slot: 'r0' } });
        expect(res).toEqual({ ok: false, error: 'already_there' });
        expect(JSON.stringify(res)).not.toContain('marta');
        expect(live('marta paez') + live('Marta Paez')).toBe(1);
        // Pedro's team may know who it is.
        session.user = OWNER;
        expect(await addHouseholdPerson({ anchorAdopterId: 'pedro', name: 'Marta Paez', fromImport: { sourceUrl: null, slot: 'r0' } }))
            .toMatchObject({ ok: true, profileId: 'marta', createdProfile: false });
    });

    it('a re-merge after the anchor moved to a new home puts the same person in the CURRENT household', async () => {
        const url = 'https://facebook.com/posts/88';
        const first = await addHouseholdPerson({ anchorAdopterId: 'pedro', name: 'Laura Paez', relationship: 'partner', fromImport: { sourceUrl: url, slot: 'r0' } });
        if (!first.ok) throw new Error('add failed');
        // Pedro leaves that household (his own row goes); his next add makes a new home.
        sqlite.prepare(`DELETE FROM household_memberships WHERE adopter_id = 'pedro'`).run();
        const again = await addHouseholdPerson({ anchorAdopterId: 'pedro', name: 'Laura Paez', relationship: 'partner', fromImport: { sourceUrl: url, slot: 'r0' } });
        expect(again).toMatchObject({ ok: true, profileId: first.profileId, createdProfile: false });
        expect(live('Laura Paez')).toBe(1);
        const home = sqlite.prepare(`SELECT household_id FROM household_memberships WHERE adopter_id = 'pedro'`).get()!.household_id;
        expect(home).not.toBe('hh-pedro');
        expect(householdOf(home as string).map(m => m.adopter_id)).toEqual(['pedro', first.profileId]);
    });
});

describe('Task 4 fix round 3', () => {
    it("gift: a click that cleared the deleted recipient and re-claimed between our key read and our cleanup keeps its household", async () => {
        const { submissionId, applicantId } = await postForm({
            name: 'Jonathan Giver', email: 'jg30@example.com', phone: '11 6123 3030', intent: 'gift',
            giftRecipient: { relationship: 'child', firstName: 'Sofía', lastName: 'Gómez', phone: '11 5555 0101' },
        });
        session.user = OWNER;
        const first = await createGiftRecipientProfile({ giverAdopterId: applicantId, submissionId });
        if (!first.ok) throw new Error(first.error);
        sqlite.prepare('UPDATE adopters SET deleted_at = 5 WHERE id = ?').run(first.profileId);
        const hh = `hh-gift-${submissionId}`;

        let aPaused!: () => void;
        const aAtAdd = new Promise<void>(r => { aPaused = r; });
        let releaseA!: () => void;
        const bDone = new Promise<void>(r => { releaseA = r; });
        let aRun: Promise<unknown> | null = null;
        // B (OWNER) has read the stale key; A (ADMIN) then runs and stops at its next membership
        // write — while B's cleanup / replacement runs.
        faults.afterKeyRead = async () => {
            faults.beforeAdd = async () => { aPaused(); await bDone; };
            aRun = createGiftRecipientFromForm(db(), { giverAdopterId: applicantId, submissionId, actor: ADMIN });
            await aAtAdd;
        };
        const b = await createGiftRecipientFromForm(db(), { giverAdopterId: applicantId, submissionId, actor: OWNER });
        releaseA();
        const a = (await aRun) as unknown as Awaited<ReturnType<typeof createGiftRecipientFromForm>>;
        // A's recipient stands; B, which read the stale key first, answers A's profile.
        expect(a).toMatchObject({ ok: true, created: true });
        expect(b).toEqual(a.ok ? { ...a, created: false } : null);
        expect(count(`SELECT COUNT(*) AS n FROM adopters WHERE name = 'Sofía Gómez' AND deleted_at IS NULL`)).toBe(1);
        const members = householdOf(hh);
        expect(members.filter(m => m.gift_recipient === 1).map(m => m.adopter_id)).toEqual([a.ok ? a.profileId : 'x']);
        expect(members.filter(m => m.gift_recipient === 0).map(m => m.adopter_id)).toEqual([applicantId]);
    });
});
