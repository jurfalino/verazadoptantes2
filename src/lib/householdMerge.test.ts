/**
 * Households as profiles, Task 6 — merges and undo on the household tables
 * (spec «Merges and undo», «No convive» memory). Real SQL (every drizzle/*.sql
 * replayed), the real mergeAdopters / unmergeAdopters / mergeCandidatePair,
 * the real token index and the real gift-recipient reads.
 *
 * Pedro's household (hh-pedro): Pedro (anchor), Marta («pareja de Pedro»),
 * Marta Dup (the same person, added again from a form). Ana's household
 * (hh-ana): Ana (anchor), Marta Dup («hermana de Ana»), Lucas («hijo de Marta Dup»).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { session, OWNER, STRANGER, ADMIN } = mocks;
const OTHER = 'other-rescuer@example.com';

const { state, notify, faults } = vi.hoisted(() => ({
    faults: {
        failReassign: false,
        beforeMergeCas: null as null | (() => void),
        /** Runs once, right after the merge read the absorbed profile's memberships. */
        afterAbsorbedRead: null as null | (() => void),
    },
    state: { db: null as unknown },
    notify: { create: [] as Array<Record<string, unknown>>, admins: [] as Array<Record<string, unknown>> },
}));

vi.mock('@/app/actions/_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/config/admins', async (orig) => ({
    ...(await orig()), isAdminAsync: mocks.isAdmin, isModeratorOrAdminAsync: mocks.isAdmin, isAdmin: (e: string | null | undefined) => e === ADMIN,
}));
vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig()), isOrgMate: mocks.isOrgMate, getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor,
    getTeamEmails: async (e: string) => mocks.getOrgMemberEmailsFor(e),
    isOwnerOrOrgMate: (v: string | null | undefined, o: string | null | undefined) => mocks.isOwnerOrOrgMate(v?.trim().toLowerCase(), o?.trim().toLowerCase()),
}));
vi.mock('@/config/features', async (orig) => ({ ...(await orig()), getFeatureFlag: vi.fn(async () => false) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async (_n: string, task: () => Promise<unknown>) => { await task(); }) }));
vi.mock('@/lib/adopterListCas', async (orig) => {
    const real = await orig<typeof import('@/lib/adopterListCas')>();
    return {
        ...real,
        casAdopterLists: vi.fn(async (...args: Parameters<typeof real.casAdopterLists>) => {
            if ((args[3] as { op?: string } | undefined)?.op === 'mergeAdopters') {
                const hook = faults.beforeMergeCas; faults.beforeMergeCas = null; hook?.();
            }
            return real.casAdopterLists(...args);
        }),
    };
});
vi.mock('@/app/actions/_recordWrite', async (orig) => {
    const real = await orig<typeof import('@/app/actions/_recordWrite')>();
    return {
        ...real,
        reassignAdopterRecords: vi.fn(async (...args: Parameters<typeof real.reassignAdopterRecords>) => {
            if (faults.failReassign) throw new Error('injected: re-point failed');
            return real.reassignAdopterRecords(...args);
        }),
    };
});
vi.mock('@/lib/households', async (orig) => {
    const real = await orig<typeof import('@/lib/households')>();
    return {
        ...real,
        membershipsOfProfile: vi.fn(async (...args: Parameters<typeof real.membershipsOfProfile>) => {
            const rows = await real.membershipsOfProfile(...args);
            if (args[1] === 'martadup' && faults.afterAbsorbedRead) { const hook = faults.afterAbsorbedRead; faults.afterAbsorbedRead = null; hook(); }
            return rows;
        }),
    };
});
vi.mock('@/lib/adopterTokenize', async (orig) => {
    const real = await orig<typeof import('@/lib/adopterTokenize')>();
    return { ...real, tokenizeAdopter: vi.fn(real.tokenizeAdopter) };
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

import { mergeAdopters, mergeCandidatePair, unmergeAdopters } from './adopterMerge';
import { ensureHousehold } from './households';
import { giftRecipientsOf } from './giftRecipients';
import { tokenizeAdopter } from './adopterTokenize';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };
const db = () => state.db as Parameters<typeof ensureHousehold>[0];

const memberships = () => sqlite.prepare('SELECT * FROM household_memberships ORDER BY id').all();
const householdOf = (hh: string) => sqlite.prepare('SELECT * FROM household_memberships WHERE household_id = ? ORDER BY id').all(hh);
const correctionsTable = () => sqlite.prepare('SELECT * FROM household_corrections ORDER BY id').all();
const deletedAt = (id: string) => sqlite.prepare('SELECT deleted_at FROM adopters WHERE id = ?').get(id)!.deleted_at;
const phoneTokens = (id: string) => sqlite.prepare(`SELECT token_value FROM duplicate_tokens WHERE adopter_id = ? AND token_type LIKE 'phone%' ORDER BY token_value`).all(id).map(r => r.token_value);
const today = () => new Date().toISOString().slice(0, 10);

function person(id: string, name: string, addedBy: string = OWNER, opts: { age?: number; createdAt?: number } = {}) {
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at, age, age_as_of) VALUES (?, ?, '5', ?, ?, ?, ?, ?)`)
        .run(id, name, addedBy, opts.createdAt ?? 1000, opts.createdAt ?? 1000, opts.age ?? null, opts.age != null ? today() : null);
}
function household(id: string) {
    sqlite.prepare(`INSERT INTO households (id, created_by, created_at) VALUES (?, ?, 900)`).run(id, OWNER);
}
function member(id: string, hh: string, adopter: string, o: { rel?: string; relTo?: string | null; addedBy?: string | null; gift?: boolean; key?: string | null; at?: number; recordedAt?: number | null } = {}) {
    sqlite.prepare(`INSERT INTO household_memberships (id, household_id, adopter_id, relationship, relative_to_adopter_id, gift_recipient, added_by, added_at, source_key, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, hh, adopter, o.rel ?? 'unknown', o.relTo ?? null, o.gift ? 1 : 0, o.addedBy === undefined ? OWNER : o.addedBy, o.at ?? 1000, o.key ?? null, o.recordedAt ?? null);
}
function correction(id: string, hh: string, adopter: string) {
    sqlite.prepare(`INSERT INTO household_corrections (id, household_id, adopter_id, corrected_by, corrected_at, snapshot) VALUES (?, ?, ?, ?, 1500, NULL)`).run(id, hh, adopter, OTHER);
}
function record(id: string, adopterId: string) {
    sqlite.prepare(`INSERT INTO animals (id, name, added_by) VALUES (?, 'Luna', ?)`).run(`an-${id}`, OWNER);
    sqlite.prepare(`INSERT INTO placements (id, animal_id, adopter_id, record_type, rating) VALUES (?, ?, ?, 'adoption', 4)`).run(id, `an-${id}`, adopterId);
}

async function merge(survivor: string, absorbed: string) {
    const res = await mergeAdopters(survivor, absorbed, ADMIN);
    expect(res.success, res.error).toBe(true);
    return res.auditId!;
}
async function undo(auditId: string) {
    const res = await unmergeAdopters(auditId, ADMIN);
    expect(res.success, res.error).toBe(true);
}

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    notify.create.length = 0;
    notify.admins.length = 0;
    Object.assign(faults, { failReassign: false, beforeMergeCas: null, afterAbsorbedRead: null });
    vi.mocked(tokenizeAdopter).mockClear();
    session.user = ADMIN;
    person('pedro', 'Pedro Paez');
    person('marta', 'Marta Paez');
    person('martadup', 'Marta Páez', STRANGER, { createdAt: 2000 });
    person('ana', 'Ana Gil', OTHER);
    person('lucas', 'Lucas Gil', OTHER);
    household('hh-pedro');
    member('hm-p1', 'hh-pedro', 'pedro', { addedBy: null, at: 1000 });
    member('hm-p2', 'hh-pedro', 'marta', { rel: 'partner', relTo: 'pedro', at: 1001, recordedAt: 1001 });
    member('hm-p3', 'hh-pedro', 'martadup', { relTo: 'pedro', addedBy: STRANGER, at: 1002, key: 'form-sub1-0' });
    household('hh-ana');
    member('hm-a1', 'hh-ana', 'ana', { addedBy: null, at: 1100 });
    member('hm-a2', 'hh-ana', 'martadup', { rel: 'sibling', relTo: 'ana', addedBy: OTHER, at: 1101 });
    member('hm-a3', 'hh-ana', 'lucas', { rel: 'child', relTo: 'martadup', addedBy: OTHER, at: 1102 });
});

describe('merges re-point memberships (spec «Merges and undo»)', () => {
    it('Marta merged with Marta Dup, both in Pedro\'s household: one membership; the duplicate\'s source key is kept on it; undo restores the exact rows', async () => {
        const before = memberships();
        const auditId = await merge('marta', 'martadup');
        const pedro = householdOf('hh-pedro');
        expect(pedro.map(r => r.adopter_id)).toEqual(['pedro', 'marta']);
        // Marta's own row stands (her relationship, her adder), and carries the form's key so a replay finds her.
        expect(pedro[1]).toMatchObject({ id: 'hm-p2', relationship: 'partner', relative_to_adopter_id: 'pedro', added_by: OWNER, source_key: 'form-sub1-0' });
        expect(memberships().filter(r => r.adopter_id === 'martadup')).toEqual([]);

        await undo(auditId);
        expect(memberships()).toEqual(before);
    });

    it('the absorbed profile\'s other household moves to the survivor, and «hijo de Marta Dup» now points at Marta; undo restores it', async () => {
        const before = memberships();
        const auditId = await merge('marta', 'martadup');
        expect(householdOf('hh-ana').map(r => [r.id, r.adopter_id, r.relative_to_adopter_id])).toEqual([
            ['hm-a1', 'ana', null], ['hm-a2', 'marta', 'ana'], ['hm-a3', 'lucas', 'marta'],
        ]);
        await undo(auditId);
        expect(memberships()).toEqual(before);
    });

    it('a member merged into its host: no self-membership, nobody relative to themselves; undo restores the exact rows', async () => {
        const before = memberships();
        const auditId = await merge('pedro', 'marta');
        expect(householdOf('hh-pedro').map(r => [r.id, r.adopter_id])).toEqual([['hm-p1', 'pedro'], ['hm-p3', 'martadup']]);
        // Pedro's own row keeps its anchor shape (his home stays his home).
        expect(householdOf('hh-pedro')[0]).toMatchObject({ relative_to_adopter_id: null, added_by: null, relationship: 'unknown' });
        expect(memberships().filter(r => r.relative_to_adopter_id === r.adopter_id)).toEqual([]);
        await undo(auditId);
        expect(memberships()).toEqual(before);
    });

    it('a host merged into its member: the member\'s row takes the anchor shape — the home stays a home — and the others point at the survivor', async () => {
        const before = memberships();
        const auditId = await merge('marta', 'pedro');
        expect(householdOf('hh-pedro').map(r => [r.id, r.adopter_id, r.relationship, r.relative_to_adopter_id, r.added_by])).toEqual([
            ['hm-p2', 'marta', 'unknown', null, null],
            ['hm-p3', 'martadup', 'unknown', 'marta', STRANGER],
        ]);
        expect(memberships().filter(r => r.relative_to_adopter_id === r.adopter_id)).toEqual([]);
        expect(await ensureHousehold(db(), 'marta', ADMIN)).toBe('hh-pedro');
        await undo(auditId);
        expect(memberships()).toEqual(before);
    });

    it('a linked form\'s applicant merged into another team\'s profile brings its household along (one reality)', async () => {
        person('target', 'Marta Paez', OTHER);
        const auditId = await merge('target', 'martadup');
        expect(householdOf('hh-pedro').map(r => r.adopter_id)).toEqual(['pedro', 'marta', 'target']);
        expect(householdOf('hh-ana').map(r => r.adopter_id)).toEqual(['ana', 'target', 'lucas']);
        await undo(auditId);
        expect(householdOf('hh-pedro').map(r => r.adopter_id)).toEqual(['pedro', 'marta', 'martadup']);
    });

    it('undo after the survivor was removed from a moved household since: that removal stands; a person added since stays', async () => {
        const auditId = await merge('marta', 'martadup');
        sqlite.prepare(`DELETE FROM household_memberships WHERE id = 'hm-a2'`).run();
        person('rosa', 'Rosa Gil', OTHER);
        member('hm-a4', 'hh-ana', 'rosa', { relTo: 'ana', addedBy: OTHER, at: 3000 });
        await undo(auditId);
        expect(householdOf('hh-ana').map(r => [r.id, r.adopter_id, r.relative_to_adopter_id])).toEqual([
            ['hm-a1', 'ana', null], ['hm-a3', 'lucas', 'martadup'], ['hm-a4', 'rosa', 'ana'],
        ]);
        expect(householdOf('hh-pedro').map(r => r.adopter_id)).toEqual(['pedro', 'marta', 'martadup']);
    });

    it('the survivor joins a household between the read and the move: collapsed, never two rows for one person', async () => {
        faults.afterAbsorbedRead = () => {
            sqlite.prepare(`INSERT INTO household_memberships (id, household_id, adopter_id, relationship, gift_recipient, added_by, added_at) VALUES ('hm-race', 'hh-ana', 'marta', 'unknown', 0, ?, 2500)`).run(OTHER);
        };
        const auditId = await merge('marta', 'martadup');
        expect(householdOf('hh-ana').map(r => [r.id, r.adopter_id])).toEqual([['hm-a1', 'ana'], ['hm-a3', 'lucas'], ['hm-race', 'marta']]);
        expect(memberships().filter(r => r.adopter_id === 'martadup')).toEqual([]);
        await undo(auditId);
        expect(householdOf('hh-ana').map(r => r.adopter_id).sort()).toEqual(['ana', 'lucas', 'marta', 'martadup']);
    });

    it('a merge failing after it moved the memberships puts every row back, and both profiles stay live', async () => {
        correction('hc-1', 'hh-ana', 'martadup');
        const before = { m: memberships(), c: correctionsTable() };
        faults.failReassign = true;
        const res = await mergeAdopters('marta', 'martadup', ADMIN);
        expect(res.success).toBe(false);
        expect({ m: memberships(), c: correctionsTable() }).toEqual(before);
        expect(deletedAt('martadup')).toBeNull();
        expect(notify.admins).toEqual([]);
    });

    it('(M4) a failed merge re-tokenizes the profile it gives back instead of trusting its old token hash', async () => {
        sqlite.prepare(`UPDATE adopters SET token_hash = 'old-hash' WHERE id = 'martadup'`).run();
        faults.failReassign = true;
        expect((await mergeAdopters('marta', 'martadup', ADMIN)).success).toBe(false);
        expect(sqlite.prepare(`SELECT deleted_at FROM adopters WHERE id = 'martadup'`).get()!.deleted_at).toBeNull();
        expect(vi.mocked(tokenizeAdopter)).toHaveBeenCalledWith('martadup');
    });

    it('(M3) the survivor merged away meanwhile: nothing moves onto it, the absorbed profile comes back', async () => {
        const before = memberships();
        faults.beforeMergeCas = () => {
            sqlite.prepare(`UPDATE adopters SET deleted_at = 9000, token_hash = 'MERGED' WHERE id = 'marta'`).run();
        };
        const res = await mergeAdopters('marta', 'martadup', ADMIN);
        expect(res).toMatchObject({ success: false, error: expect.stringContaining('Merge failed') });
        expect(memberships()).toEqual(before);
        expect(deletedAt('martadup')).toBeNull();
    });

    it('joining by merge clears the survivor\'s pending duplicate pairs with its new housemates (Task 5 join rule)', async () => {
        sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, match_values, score, confidence, status, detected_at)
            VALUES ('cand-ma', 'marta', 'ana', '["name_word"]', '{}', 40, 'medium', 'pending', 1000), ('cand-mr', 'marta', 'rosa', '["name_word"]', '{}', 40, 'medium', 'pending', 1000)`).run();
        await merge('marta', 'martadup');
        expect(sqlite.prepare(`SELECT id FROM duplicate_candidates ORDER BY id`).all().map(r => r.id)).toEqual(['cand-mr']);
    });
});

describe('«No convive» memory follows merges (D48)', () => {
    it('corrections naming the absorbed profile now name the survivor; undo puts them back', async () => {
        person('rosa', 'Rosa Gil', OTHER);
        household('hh-rosa');
        member('hm-r1', 'hh-rosa', 'rosa', { addedBy: null });
        correction('hc-1', 'hh-rosa', 'martadup');
        const auditId = await merge('marta', 'martadup');
        expect(correctionsTable().map(c => [c.id, c.household_id, c.adopter_id])).toEqual([['hc-1', 'hh-rosa', 'marta']]);
        expect(notify.admins).toEqual([]); // Marta doesn't live in hh-rosa: nothing disputed
        await undo(auditId);
        expect(correctionsTable().map(c => [c.id, c.adopter_id])).toEqual([['hc-1', 'martadup']]);
    });

    it('a merge that brings a corrected person back into that household (the duplicate still lived there): the admins are told', async () => {
        // Someone said Marta does not live with Ana; Marta Dup still lists her there.
        correction('hc-1', 'hh-ana', 'marta');
        await merge('marta', 'martadup');
        expect(notify.admins).toEqual([expect.objectContaining({
            actorEmail: ADMIN, type: 'household_member_disputed',
            metadata: expect.objectContaining({ householdId: 'hh-ana', profileId: 'marta' }),
        })]);
        expect(notify.admins[0].body).toContain('combinar');
    });

    it('the other direction: the absorbed profile\'s correction lands on a household the survivor lives in — also a dispute', async () => {
        person('rosa', 'Rosa Gil', OTHER);
        household('hh-rosa');
        member('hm-r1', 'hh-rosa', 'rosa', { addedBy: null });
        member('hm-r2', 'hh-rosa', 'marta', { relTo: 'rosa', addedBy: OTHER });
        correction('hc-1', 'hh-rosa', 'martadup');
        await merge('marta', 'martadup');
        expect(notify.admins).toEqual([expect.objectContaining({ type: 'household_member_disputed', metadata: expect.objectContaining({ householdId: 'hh-rosa', profileId: 'marta' }) })]);
    });

    it('a dispute that already stood before the merge is not raised again', async () => {
        correction('hc-1', 'hh-pedro', 'marta'); // Marta was re-added after it: disputed back then
        await merge('marta', 'martadup');
        expect(notify.admins).toEqual([]);
    });
});

describe('minors never receive records through a merge (ruling, Task 6)', () => {
    beforeEach(() => {
        person('kid', 'Tomás Gil', OTHER, { age: 12 });
        person('kiddup', 'Tomas Gil', OTHER, { createdAt: 3000 });
    });

    it('a minor survivor with an absorbed side that has records is refused, nothing moves; keeping the other side works', async () => {
        record('pl-1', 'kiddup');
        expect(await mergeAdopters('kid', 'kiddup', ADMIN)).toEqual({ success: false, error: 'minor_survivor_has_activity' });
        expect(deletedAt('kiddup')).toBeNull();
        expect(sqlite.prepare(`SELECT adopter_id FROM placements WHERE id = 'pl-1'`).get()!.adopter_id).toBe('kiddup');
        expect((await mergeAdopters('kiddup', 'kid', ADMIN)).success).toBe(true);
    });

    it('an open alert counts as activity too', async () => {
        sqlite.prepare(`INSERT INTO adopter_flags (id, adopter_id, flagged_by, reason) VALUES ('f1', 'kiddup', ?, 'inaccurate_information')`).run(OTHER);
        expect(await mergeAdopters('kid', 'kiddup', ADMIN)).toMatchObject({ success: false, error: 'minor_survivor_has_activity' });
    });

    it('an absorbed side with no records or alerts merges into a minor as usual', async () => {
        expect((await mergeAdopters('kid', 'kiddup', ADMIN)).success).toBe(true);
    });

    it('the automatic pair merge keeps the adult when it would otherwise keep the minor', async () => {
        record('pl-1', 'kiddup');
        record('pl-2', 'kid'); // a legacy record on the minor: activity ties, the minor is older
        sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, match_values, score, confidence, status, detected_at)
            VALUES ('cand-kid', 'kid', 'kiddup', '["name_full"]', '{}', 80, 'high', 'pending', 1000)`).run();
        const res = await mergeCandidatePair('cand-kid', ADMIN);
        expect(res).toMatchObject({ success: true, primaryId: 'kiddup', secondaryId: 'kid' });
    });
});

describe('gift recipients and gift forms follow merges (Task 4 carry)', () => {
    beforeEach(() => {
        person('giver', 'Jonathan Giver');
        person('giver2', 'Jonathan Giver Dup', OWNER, { createdAt: 500 });
        person('sofia', 'Sofía Gómez');
        person('sofia2', 'Sofia Gomez', OWNER, { createdAt: 3000 });
        sqlite.prepare(`INSERT INTO form_submissions (id, user_id, name, intent, answers_json, linked_adopter_id, created_at) VALUES ('sub-g', ?, 'Jonathan Giver', 'gift', ?, 'giver', 1000)`)
            .run(OWNER, JSON.stringify({ giftRecipient: { relationship: 'child', firstName: 'Sofía', lastName: 'Gómez', phone: '11 5555 0101' } }));
        household('hh-gift-sub-g');
        member('hm-g1', 'hh-gift-sub-g', 'sofia', { rel: 'child', relTo: 'giver', gift: true, key: 'gift-sub-g', at: 1000 });
        member('hm-g2', 'hh-gift-sub-g', 'giver', { addedBy: null, at: 1001 });
    });

    it('the recipient merged into another profile: the gift membership (and its key) follow, so «Crear perfil» shows the survivor; undo gives it back', async () => {
        const auditId = await merge('sofia2', 'sofia');
        expect(householdOf('hh-gift-sub-g').map(r => [r.adopter_id, r.gift_recipient, r.source_key])).toEqual([['sofia2', 1, 'gift-sub-g'], ['giver', 0, null]]);
        expect(await giftRecipientsOf(db(), 'giver')).toEqual([expect.objectContaining({ profileId: 'sofia2' })]);
        await undo(auditId);
        expect(await giftRecipientsOf(db(), 'giver')).toEqual([expect.objectContaining({ profileId: 'sofia' })]);
    });

    it('the recipient merged into the giver (one person): the giver\'s row keeps the gift mark and key, so it never becomes an ordinary home; undo restores the rows', async () => {
        const before = memberships();
        const auditId = await merge('giver', 'sofia');
        expect(householdOf('hh-gift-sub-g').map(r => [r.adopter_id, r.gift_recipient, r.source_key])).toEqual([['giver', 1, 'gift-sub-g']]);
        expect(await giftRecipientsOf(db(), 'giver')).toEqual([expect.objectContaining({ profileId: 'giver' })]);
        expect(await ensureHousehold(db(), 'giver', ADMIN)).not.toBe('hh-gift-sub-g');
        await undo(auditId);
        expect(memberships().filter(r => r.household_id !== 'hh-giver')).toEqual(before);
    });

    it('the giver merged into another profile: the gift form and the recipient\'s phone token move with it; undo moves them back', async () => {
        await tokenizeAdopter('giver', { force: true });
        await tokenizeAdopter('giver2', { force: true });
        const giftPhone = phoneTokens('giver');
        expect(giftPhone.length).toBeGreaterThan(0);
        expect(phoneTokens('giver2')).toEqual([]);

        const auditId = await merge('giver2', 'giver');
        expect(phoneTokens('giver2')).toEqual(giftPhone);
        expect(householdOf('hh-gift-sub-g').map(r => r.adopter_id)).toEqual(['sofia', 'giver2']);
        expect(await giftRecipientsOf(db(), 'giver2')).toEqual([expect.objectContaining({ profileId: 'sofia' })]);

        await undo(auditId);
        expect(phoneTokens('giver')).toEqual(giftPhone);
        expect(phoneTokens('giver2')).toEqual([]);
        expect(vi.mocked(tokenizeAdopter)).toHaveBeenCalledWith('giver', { force: true });
        expect(vi.mocked(tokenizeAdopter)).toHaveBeenCalledWith('giver2', { force: true });
    });
});

describe('the merge no longer touches the old household stores', () => {
    it('household_members JSON and household_links stay as they were on both sides', async () => {
        sqlite.prepare(`UPDATE adopters SET household_members = ? WHERE id = 'martadup'`).run(JSON.stringify([{ id: 'm-old', name: 'Tío Juan', relationship: 'unknown', contactEntries: [] }]));
        await merge('marta', 'martadup');
        expect(sqlite.prepare(`SELECT household_members FROM adopters WHERE id = 'marta'`).get()!.household_members).toBeNull();
        expect(JSON.parse(sqlite.prepare(`SELECT household_members FROM adopters WHERE id = 'martadup'`).get()!.household_members as string)).toHaveLength(1);
        const audit = JSON.parse(sqlite.prepare(`SELECT details FROM audit_log WHERE action = 'adopter_merge'`).get()!.details as string);
        expect(audit.undo.addedHouseholdMemberIds).toBeUndefined();
        expect(audit.undo.householdLinks).toBeUndefined();
        expect(audit.undo.householdMemberships).toBeDefined();
    });
});
