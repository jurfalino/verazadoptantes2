/**
 * Households as profiles — the read/write core (src/lib/households.ts). Real
 * SQL (every drizzle/*.sql replayed), the real visibility resolver and
 * masking; admins / teams come from the shared action mocks.
 * OWNER (team: MATE) owns Pedro and Marta; STRANGER owns Lucas.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { OWNER, MATE, STRANGER, ADMIN } = mocks;
const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));

vi.mock('@/app/actions/_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/config/admins', () => ({ isAdminAsync: mocks.isAdmin, isModeratorOrAdminAsync: mocks.isAdmin }));
vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig()), isOrgMate: mocks.isOrgMate, getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor,
    isOwnerOrOrgMate: (v: string | null | undefined, o: string | null | undefined) => mocks.isOwnerOrOrgMate(v?.trim().toLowerCase(), o?.trim().toLowerCase()),
}));
// PII gating ON, so "a stranger sees masked" actually tests masking.
vi.mock('@/config/features', async (orig) => ({
    ...(await orig()),
    getFeatureFlag: vi.fn(async (flag: string) => flag === 'ENABLE_PII_ACCESS_GATING'),
}));
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
    withTrace: (_op: string, fn: () => unknown) => fn(),
}));

import {
    addMembership, ensureHousehold, getHouseholdsFor, hasCorrection, householdIdsOf, householdLinesFor,
    MAX_CARD_PROFILE_READS, removeMembership, sameHousehold,
} from './households';
import { logger } from '@/lib/logger';
import { MAX_HOUSEHOLD_LINES, currentAge } from '@/domain/households';

type Row = Record<string, unknown>;
type Sqlite = {
    prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] };
    exec: (s: string) => void;
};
let sqlite: Sqlite;
// The lib takes the drizzle handle; tests hand it the in-memory one.
const db = () => state.db as Parameters<typeof getHouseholdsFor>[0];

const MARTA_CONTACTS = [
    { id: 'c1', type: 'phone', value: '+54 11 5555 0101' },
    { id: 'c2', type: 'email', value: 'marta@example.org' },
];

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as Sqlite;
    vi.mocked(logger.warn).mockClear();
    const insert = sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at, contact_entries, age, age_as_of, is_minor, deleted_at)
        VALUES (?, ?, '5', ?, 1000, 1000, ?, ?, ?, ?, ?)`);
    insert.run('pedro', 'Pedro Paez', OWNER, null, null, null, 0, null);
    insert.run('marta', 'Marta Paez', OWNER, JSON.stringify(MARTA_CONTACTS), null, null, 0, null);
    insert.run('lucas', 'Lucas Paez', STRANGER, null, 12, '2026-01-01', 1, null);
    insert.run('rosa', 'Rosa Diaz', STRANGER, null, null, null, 0, null);
    insert.run('ana', 'Ana Gift', OWNER, null, null, null, 0, null);
    insert.run('gone', 'Merged Away', OWNER, null, null, null, 0, 5000);
    sqlite.prepare(`INSERT INTO user (id, name, email) VALUES ('u1', 'Gatitos Olivos', ?)`).run(OWNER);
    // Pedro is rated 1 with one open alert.
    sqlite.prepare(`INSERT INTO animals (id, name, added_by) VALUES ('an1', 'Luna', ?)`).run(OWNER);
    sqlite.prepare(`INSERT INTO placements (id, animal_id, adopter_id, record_type, rating) VALUES ('p1', 'an1', 'pedro', 'adoption', 1)`).run();
    sqlite.prepare(`INSERT INTO adopter_flags (id, adopter_id, flagged_by, reason) VALUES ('f1', 'pedro', ?, 'inaccurate_information')`).run(MATE);
});

const memberships = () => sqlite.prepare('SELECT * FROM household_memberships ORDER BY household_id, adopter_id').all();

/** Pedro's household: Pedro (anchor), Marta (partner of Pedro), Lucas (child of Pedro, added by STRANGER). */
async function pedrosHousehold(): Promise<string> {
    const hh = await ensureHousehold(db(), 'pedro', OWNER);
    await addMembership(db(), { householdId: hh, adopterId: 'marta', relationship: 'partner', relativeToAdopterId: 'pedro', addedBy: OWNER });
    await addMembership(db(), { householdId: hh, adopterId: 'lucas', relationship: 'child', relativeToAdopterId: 'pedro', addedBy: STRANGER });
    return hh;
}

describe('migration 0096', () => {
    it('creates the tables and the adopter age columns; the (household, adopter) pair is unique', () => {
        const cols = (t: string) => sqlite.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
        expect(cols('households')).toEqual(['id', 'created_by', 'created_at']);
        expect(cols('household_memberships')).toEqual([
            'id', 'household_id', 'adopter_id', 'relationship', 'relative_to_adopter_id', 'gift_recipient', 'added_by', 'added_at', 'source_key',
        ]);
        expect(cols('household_corrections')).toEqual(['id', 'household_id', 'adopter_id', 'corrected_by', 'corrected_at', 'snapshot']);
        expect(cols('adopters')).toEqual(expect.arrayContaining(['age', 'age_as_of', 'is_minor']));
        const ins = sqlite.prepare(`INSERT INTO household_memberships (id, household_id, adopter_id, added_at) VALUES (?, 'h', 'a', 1)`);
        ins.run('m1');
        expect(() => ins.run('m2')).toThrow(/UNIQUE/);
        expect(sqlite.prepare(`SELECT relationship, gift_recipient FROM household_memberships WHERE id = 'm1'`).get())
            .toEqual({ relationship: 'unknown', gift_recipient: 0 });
        const idx = sqlite.prepare(`PRAGMA index_list(household_memberships)`).all().map(i => i.name);
        expect(idx).toEqual(expect.arrayContaining([
            'idx_household_memberships_pair', 'idx_household_memberships_adopter', 'idx_household_memberships_household', 'idx_household_memberships_source_key',
        ]));
    });
});

describe('write core', () => {
    it('addMembership twice → one row, the same id, created only the first time', async () => {
        const hh = await ensureHousehold(db(), 'pedro', OWNER);
        const a = await addMembership(db(), { householdId: hh, adopterId: 'marta', relationship: 'partner', relativeToAdopterId: 'pedro', addedBy: OWNER, sourceKey: 'form-s1-0' });
        const b = await addMembership(db(), { householdId: hh, adopterId: 'marta', relationship: 'child', relativeToAdopterId: 'pedro', addedBy: STRANGER });
        expect(a.created).toBe(true);
        expect(b).toEqual({ membershipId: a.membershipId, created: false });
        const rows = memberships().filter(r => r.adopter_id === 'marta');
        expect(rows).toEqual([expect.objectContaining({
            id: a.membershipId, household_id: hh, relationship: 'partner', relative_to_adopter_id: 'pedro', added_by: OWNER, gift_recipient: 0, source_key: 'form-s1-0',
        })]);
    });

    it('addMembership racing itself on the same pair → one row, both callers get the same membership id', async () => {
        const hh = await ensureHousehold(db(), 'pedro', OWNER);
        const input = { householdId: hh, adopterId: 'marta', relationship: 'partner', relativeToAdopterId: 'pedro', addedBy: OWNER };
        const [a, b] = await Promise.all([addMembership(db(), input), addMembership(db(), { ...input, addedBy: MATE })]);
        expect(a.membershipId).toBe(b.membershipId);
        expect([a.created, b.created].sort()).toEqual([false, true]);
        expect(memberships().filter(r => r.adopter_id === 'marta')).toHaveLength(1);
    });

    it('ensureHousehold racing itself → one household with the anchor once, no orphan', async () => {
        const [a, b] = await Promise.all([ensureHousehold(db(), 'pedro', OWNER), ensureHousehold(db(), 'pedro', MATE)]);
        expect(b).toBe(a);
        expect(sqlite.prepare('SELECT id FROM households').all()).toEqual([{ id: a }]);
        expect(memberships()).toHaveLength(1);
        expect(await householdIdsOf(db(), 'pedro')).toEqual([a]);
    });

    it('ensureHousehold racing itself when hh-{anchor} is taken (anchor removed from it once) → one new household, the loser cleaned up', async () => {
        sqlite.exec(`INSERT INTO households (id, created_by, created_at) VALUES ('hh-pedro', '${OWNER}', 1)`);
        await addMembership(db(), { householdId: 'hh-pedro', adopterId: 'marta', addedBy: OWNER });
        const [a, b, c] = await Promise.all([1, 2, 3].map(() => ensureHousehold(db(), 'pedro', OWNER)));
        expect(new Set([a, b, c]).size).toBe(1);
        expect(a).not.toBe('hh-pedro');
        expect(await householdIdsOf(db(), 'pedro')).toEqual([a]);
        expect(sqlite.prepare('SELECT id FROM households ORDER BY id').all().map(r => r.id).sort()).toEqual([a, 'hh-pedro'].sort());
        // Pedro was never put back into the household he was taken out of.
        expect(memberships().filter(r => r.household_id === 'hh-pedro').map(r => r.adopter_id)).toEqual(['marta']);
    });

    it('a relationship outside the list is stored as unknown; a person is never relative to themselves', async () => {
        const hh = await ensureHousehold(db(), 'pedro', OWNER);
        await addMembership(db(), { householdId: hh, adopterId: 'marta', relationship: 'enemy', relativeToAdopterId: 'marta', addedBy: OWNER });
        expect(memberships().find(r => r.adopter_id === 'marta')).toMatchObject({ relationship: 'unknown', relative_to_adopter_id: null });
    });

    it('ensureHousehold creates one household with the anchor in it, and returns it again after', async () => {
        const a = await ensureHousehold(db(), 'pedro', OWNER);
        const b = await ensureHousehold(db(), 'pedro', MATE);
        expect(b).toBe(a);
        expect(sqlite.prepare('SELECT id, created_by FROM households').all()).toEqual([{ id: a, created_by: OWNER }]);
        expect(memberships()).toEqual([expect.objectContaining({ household_id: a, adopter_id: 'pedro', relationship: 'unknown', added_by: OWNER })]);
        expect(await householdIdsOf(db(), 'pedro')).toEqual([a]);
    });

    it("ensureHousehold returns the household the anchor was added to, and never a gift household", async () => {
        const hh = await pedrosHousehold();
        expect(await ensureHousehold(db(), 'marta', MATE)).toBe(hh);
        // Ana's only household is a gift one: a new ordinary household is made for her.
        sqlite.exec(`INSERT INTO households (id, created_by, created_at) VALUES ('gift1', '${OWNER}', 1)`);
        await addMembership(db(), { householdId: 'gift1', adopterId: 'ana', addedBy: OWNER });
        await addMembership(db(), { householdId: 'gift1', adopterId: 'rosa', giftRecipient: true, addedBy: OWNER });
        const own = await ensureHousehold(db(), 'ana', OWNER);
        expect(own).not.toBe('gift1');
        // With a gift household in the DB, everyone else's existing household is still found.
        expect(await ensureHousehold(db(), 'marta', MATE)).toBe(hh);
        expect(await ensureHousehold(db(), 'pedro', MATE)).toBe(hh);
        expect(await ensureHousehold(db(), 'ana', OWNER)).toBe(own);
        expect((await householdIdsOf(db(), 'ana')).sort()).toEqual(['gift1', own].sort());
    });

    it('removeMembership: a mistake leaves no record; «No vive acá» writes a correction with the snapshot; the household stays', async () => {
        const hh = await pedrosHousehold();
        const marta = memberships().find(r => r.adopter_id === 'marta')!;
        const lucas = memberships().find(r => r.adopter_id === 'lucas')!;

        const r1 = await removeMembership(db(), String(marta.id), STRANGER, { correction: false });
        expect(r1.removed).toMatchObject({ id: marta.id, adopterId: 'marta', householdId: hh });
        expect(r1.correctionId).toBeNull();
        expect(sqlite.prepare('SELECT COUNT(*) AS n FROM household_corrections').get()).toEqual({ n: 0 });
        expect(await hasCorrection(db(), hh, 'marta')).toBe(false);

        const r2 = await removeMembership(db(), String(lucas.id), MATE, { correction: true });
        expect(r2.correctionId).toBeTruthy();
        const c = sqlite.prepare('SELECT * FROM household_corrections').get()!;
        expect(c).toMatchObject({ id: r2.correctionId, household_id: hh, adopter_id: 'lucas', corrected_by: MATE });
        expect(JSON.parse(String(c.snapshot))).toMatchObject({ id: lucas.id, adopterId: 'lucas', relationship: 'child', relativeToAdopterId: 'pedro', addedBy: STRANGER });
        expect(await hasCorrection(db(), hh, 'lucas')).toBe(true);

        expect(memberships().map(r => r.adopter_id)).toEqual(['pedro']);
        expect(sqlite.prepare('SELECT id FROM households').all()).toEqual([{ id: hh }]);
        // Gone already: nothing happens.
        expect(await removeMembership(db(), String(lucas.id), MATE, { correction: true })).toEqual({ removed: null, correctionId: null });
    });

    it('sameHousehold: housemates yes, strangers no, a gift household does not count, self is not a housemate', async () => {
        await pedrosHousehold();
        expect(await sameHousehold(db(), 'marta', 'lucas')).toBe(true);
        expect(await sameHousehold(db(), 'pedro', 'marta')).toBe(true);
        expect(await sameHousehold(db(), 'pedro', 'rosa')).toBe(false);
        expect(await sameHousehold(db(), 'pedro', 'pedro')).toBe(false);
        sqlite.exec(`INSERT INTO households (id, created_by, created_at) VALUES ('gift1', '${OWNER}', 1)`);
        await addMembership(db(), { householdId: 'gift1', adopterId: 'ana', addedBy: OWNER });
        await addMembership(db(), { householdId: 'gift1', adopterId: 'rosa', giftRecipient: true, addedBy: OWNER });
        expect(await sameHousehold(db(), 'ana', 'rosa')).toBe(false);
        // A gift household elsewhere never hides ordinary ones (the NOT EXISTS is correlated to each household).
        expect(await sameHousehold(db(), 'marta', 'lucas')).toBe(true);
        const rosas = await ensureHousehold(db(), 'rosa', STRANGER);
        await addMembership(db(), { householdId: rosas, adopterId: 'lucas', addedBy: STRANGER });
        expect(await sameHousehold(db(), 'rosa', 'lucas')).toBe(true);
        expect(await sameHousehold(db(), 'pedro', 'rosa')).toBe(false);
    });
});

describe('getHouseholdsFor', () => {
    it("excludes the viewed profile; labels per spec; each member's live summary", async () => {
        const hh = await pedrosHousehold();
        const [view] = await getHouseholdsFor(db(), OWNER, 'lucas');
        expect(view.id).toBe(hh);
        expect(view.isGift).toBe(false);
        expect(view.members.map(m => m.profileId).sort()).toEqual(['marta', 'pedro']);
        const pedro = view.members.find(m => m.profileId === 'pedro')!;
        const marta = view.members.find(m => m.profileId === 'marta')!;
        expect(pedro).toMatchObject({ name: 'Pedro Paez', rating: 1, openAlerts: 1, adoptions: 1, label: null, ownerName: 'Gatitos Olivos', addedByName: 'Gatitos Olivos', isMinor: false });
        expect(pedro.linkId).toBe(pedro.membershipId);
        expect(marta.label).toEqual({ key: 'adopter.hh_rel_of', params: { rel: 'adopter.hh_rel_partner', name: 'Pedro Paez' } });

        const onMarta = (await getHouseholdsFor(db(), OWNER, 'marta'))[0].members;
        expect(onMarta.find(m => m.profileId === 'pedro')!.label).toEqual({ key: 'adopter.hh_rel_partner', params: {} });
        const lucas = onMarta.find(m => m.profileId === 'lucas')!;
        expect(lucas).toMatchObject({ isMinor: true, age: currentAge({ age: 12, ageAsOf: '2026-01-01' }), relationship: 'child', relativeToAdopterId: 'pedro', addedByName: 'stranger' });
        expect(lucas.label).toEqual({ key: 'adopter.hh_rel_of', params: { rel: 'adopter.hh_rel_child', name: 'Pedro Paez' } });
    });

    it('two households → two views', async () => {
        await pedrosHousehold();
        const second = await ensureHousehold(db(), 'rosa', STRANGER);
        await addMembership(db(), { householdId: second, adopterId: 'lucas', relationship: 'child', relativeToAdopterId: 'rosa', addedBy: STRANGER });
        const views = await getHouseholdsFor(db(), STRANGER, 'lucas');
        expect(views.map(v => v.members.map(m => m.profileId).sort())).toEqual([['marta', 'pedro'], ['rosa']]);
        // Lucas is Rosa's child; Rosa gets no reverse «madre» label (no gender, no reverse labels).
        expect(views[1].members[0].label).toBeNull();
    });

    it('a gift household is flagged', async () => {
        sqlite.exec(`INSERT INTO households (id, created_by, created_at) VALUES ('gift1', '${OWNER}', 1)`);
        await addMembership(db(), { householdId: 'gift1', adopterId: 'ana', addedBy: OWNER });
        await addMembership(db(), { householdId: 'gift1', adopterId: 'rosa', giftRecipient: true, addedBy: OWNER });
        const [view] = await getHouseholdsFor(db(), OWNER, 'ana');
        expect(view).toMatchObject({ id: 'gift1', isGift: true });
        expect(view.members).toEqual([expect.objectContaining({ profileId: 'rosa', giftRecipient: true })]);
        expect((await getHouseholdsFor(db(), OWNER, 'rosa'))[0].isGift).toBe(true);
    });

    it("a masked viewer gets the member's contacts masked as her profile masks them; her team sees them in full; no rescuer email leaks", async () => {
        await pedrosHousehold();
        const asStranger = (await getHouseholdsFor(db(), STRANGER, 'lucas'))[0].members.find(m => m.profileId === 'marta')!;
        expect(asStranger.canSeeContact).toBe(false);
        expect(asStranger.contacts).toHaveLength(2);
        expect(asStranger.contacts.every(c => c.masked)).toBe(true);
        expect(asStranger.contacts.map(c => c.value)).not.toContain('marta@example.org');
        expect(asStranger.contacts.map(c => c.value)).not.toContain('+54 11 5555 0101');

        const asMate = (await getHouseholdsFor(db(), MATE, 'lucas'))[0].members.find(m => m.profileId === 'marta')!;
        expect(asMate.canSeeContact).toBe(true);
        expect(asMate.contacts.map(c => c.value)).toEqual(['+54 11 5555 0101', 'marta@example.org']);

        for (const viewer of [STRANGER, MATE, OWNER, null]) {
            for (const id of ['pedro', 'marta', 'lucas']) {
                const json = JSON.stringify(await getHouseholdsFor(db(), viewer, id));
                for (const email of [OWNER, MATE, STRANGER, ADMIN]) expect(json, `${viewer} on ${id}`).not.toContain(email);
            }
        }
    });

    it('a deleted profile is skipped; a household with nobody else live shows no view; a deleted viewed profile shows nothing', async () => {
        const hh = await pedrosHousehold();
        await addMembership(db(), { householdId: hh, adopterId: 'gone', relationship: 'sibling', relativeToAdopterId: 'pedro', addedBy: OWNER });
        expect((await getHouseholdsFor(db(), OWNER, 'pedro'))[0].members.map(m => m.profileId).sort()).toEqual(['lucas', 'marta']);
        const lonely = await ensureHousehold(db(), 'rosa', STRANGER);
        await addMembership(db(), { householdId: lonely, adopterId: 'gone', addedBy: STRANGER });
        expect(await getHouseholdsFor(db(), STRANGER, 'rosa')).toEqual([]);
        expect(await getHouseholdsFor(db(), OWNER, 'gone')).toEqual([]);
    });

    it('canRemove: the adder, a housemate team, an admin — not a stranger; canReportNotLiving follows canRemove', async () => {
        await pedrosHousehold();
        const flags = async (viewer: string | null, on: string, member: string) => {
            const m = (await getHouseholdsFor(db(), viewer, on))[0].members.find(x => x.profileId === member)!;
            return [m.canRemove, m.canReportNotLiving];
        };
        // STRANGER added Lucas (and owns him): may remove him; Marta was added by OWNER.
        expect(await flags(STRANGER, 'pedro', 'lucas')).toEqual([true, true]);
        // STRANGER owns Lucas, a profile in the household: privileged on a housemate → may remove Marta too.
        expect(await flags(STRANGER, 'pedro', 'marta')).toEqual([true, true]);
        // MATE: team of Pedro and Marta.
        expect(await flags(MATE, 'lucas', 'marta')).toEqual([true, true]);
        expect(await flags(ADMIN, 'lucas', 'marta')).toEqual([true, true]);
        expect(await flags('other@example.com', 'lucas', 'marta')).toEqual([false, false]);
        expect(await flags(null, 'lucas', 'marta')).toEqual([false, false]);
    });

    it('the pre-read hook runs before the read (Task 7 converts there); a failing hook is logged and the read goes on', async () => {
        const hh = await ensureHousehold(db(), 'pedro', OWNER);
        const hook = vi.fn(async (d: Parameters<typeof getHouseholdsFor>[0], id: string) => {
            await addMembership(d, { householdId: hh, adopterId: 'marta', relationship: 'partner', relativeToAdopterId: id, addedBy: OWNER });
        });
        const views = await getHouseholdsFor(db(), OWNER, 'pedro', { beforeRead: hook });
        expect(hook).toHaveBeenCalledWith(db(), 'pedro');
        expect(views[0].members.map(m => m.profileId)).toEqual(['marta']);

        const failing = vi.fn(async () => { throw new Error('boom'); });
        expect((await getHouseholdsFor(db(), OWNER, 'pedro', { beforeRead: failing }))[0].members).toHaveLength(1);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('households'), expect.objectContaining({ adopterId: 'pedro', error: 'boom' }));
    });

    it("one member's failed profile read skips that member (logged with context), not the whole section", async () => {
        await pedrosHousehold();
        const handle = state.db as { select: (cols?: Record<string, unknown>) => unknown };
        const real = handle.select.bind(handle);
        let profileReads = 0;
        const spy = vi.spyOn(handle, 'select').mockImplementation((cols?: Record<string, unknown>) => {
            // Profile reads select ageAsOf: the 1st is Pedro (viewed), the 2nd Marta.
            if (cols && 'ageAsOf' in cols && ++profileReads === 2) {
                return { from: () => ({ where: () => ({ get: async () => { throw new Error('D1 hiccup'); } }) }) };
            }
            return real(cols);
        });
        try {
            const views = await getHouseholdsFor(db(), OWNER, 'pedro');
            expect(views[0].members.map(m => m.profileId)).toEqual(['lucas']);
            expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('households'),
                expect.objectContaining({ adopterId: 'pedro', viewer: OWNER, profileId: 'marta', error: 'D1 hiccup' }));
        } finally {
            spy.mockRestore();
        }
    });

    it('never throws: a broken read is logged and shows no households', async () => {
        await pedrosHousehold();
        sqlite.exec('DROP TABLE household_memberships');
        expect(await getHouseholdsFor(db(), OWNER, 'pedro')).toEqual([]);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('households'), expect.objectContaining({ adopterId: 'pedro' }));
    });
});

describe('householdLinesFor', () => {
    it("each profile's housemates with live rating and alerts; gift and minors flagged; no household → []", async () => {
        await pedrosHousehold();
        sqlite.exec(`INSERT INTO households (id, created_by, created_at) VALUES ('gift1', '${OWNER}', 1)`);
        await addMembership(db(), { householdId: 'gift1', adopterId: 'ana', addedBy: OWNER });
        await addMembership(db(), { householdId: 'gift1', adopterId: 'rosa', giftRecipient: true, addedBy: OWNER });

        const lines = await householdLinesFor(db(), STRANGER, ['lucas', 'marta', 'ana', 'gone', 'nobody']);
        expect(Object.keys(lines).sort()).toEqual(['ana', 'gone', 'lucas', 'marta', 'nobody']);
        expect(lines.lucas).toEqual(expect.arrayContaining([
            { name: 'Pedro Paez', profileId: 'pedro', rating: 1, openAlerts: 1, isMinor: false, isGift: false },
            { name: 'Marta Paez', profileId: 'marta', rating: null, openAlerts: 0, isMinor: false, isGift: false },
        ]));
        expect(lines.lucas).toHaveLength(2);
        expect(lines.marta.find(l => l.profileId === 'lucas')).toEqual({ name: 'Lucas Paez', profileId: 'lucas', rating: null, openAlerts: 0, isMinor: true, isGift: false });
        expect(lines.ana).toEqual([{ name: 'Rosa Diaz', profileId: 'rosa', rating: null, openAlerts: 0, isMinor: false, isGift: true }]);
        expect(lines.nobody).toEqual([]);
        expect(lines.gone).toEqual([]);
    });

    it('a big household reads at most the cap: profile reads stop once the card line is full, and deleted rows cannot make it read without end', async () => {
        const hh = await ensureHousehold(db(), 'pedro', OWNER);
        const insert = sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at, deleted_at) VALUES (?, ?, '5', ?, 1000, 1000, ?)`);
        // 25 deleted housemates first, then 4 live ones.
        for (let i = 0; i < 29; i++) {
            const id = `big${String(i).padStart(2, '0')}`;
            insert.run(id, `Person ${i}`, OWNER, i < 25 ? 5000 : null);
            await addMembership(db(), { householdId: hh, adopterId: id, addedBy: OWNER, addedAt: new Date(1_000_000 + i * 1000) });
        }
        const handle = state.db as { select: (cols?: Record<string, unknown>) => unknown };
        const spy = vi.spyOn(handle, 'select');
        const profileReads = () => spy.mock.calls.filter(([cols]) => !!cols && 'ageAsOf' in (cols as object)).length;
        try {
            const { pedro } = await householdLinesFor(db(), OWNER, ['pedro']);
            expect(profileReads()).toBeLessThanOrEqual(MAX_CARD_PROFILE_READS);
            // The hard cap may hide live people behind many deleted ones; it never reads them all.
            expect(pedro.length).toBeLessThanOrEqual(MAX_HOUSEHOLD_LINES);

            // All live: reading stops as soon as MAX_HOUSEHOLD_LINES are found.
            sqlite.exec('UPDATE adopters SET deleted_at = NULL');
            spy.mockClear();
            const lines = (await householdLinesFor(db(), OWNER, ['pedro'])).pedro;
            expect(lines).toHaveLength(MAX_HOUSEHOLD_LINES);
            expect(profileReads()).toBe(MAX_HOUSEHOLD_LINES);
        } finally {
            spy.mockRestore();
        }
    });

    it('a housemate shared through two households is one line; a deleted housemate is left out', async () => {
        const hh = await pedrosHousehold();
        await addMembership(db(), { householdId: hh, adopterId: 'gone', addedBy: OWNER });
        const second = await ensureHousehold(db(), 'rosa', STRANGER);
        await addMembership(db(), { householdId: second, adopterId: 'lucas', addedBy: STRANGER });
        await addMembership(db(), { householdId: second, adopterId: 'pedro', addedBy: STRANGER });
        const { lucas } = await householdLinesFor(db(), null, ['lucas']);
        expect(lucas.map(l => l.profileId).sort()).toEqual(['marta', 'pedro', 'rosa']);
    });
});
