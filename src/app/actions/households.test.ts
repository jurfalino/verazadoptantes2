/**
 * Households as profiles — the actions people use (Task 2): add a person
 * (new or existing profile), change the relationship, remove («Lo cargué por
 * error» / «No vive acá»), and the «¿Es este perfil?» candidates. Real SQL
 * (every drizzle/*.sql replayed), the real contribution side effects, the
 * real approver / visibility resolvers and the real duplicate engine; the
 * session is the only source of the actor.
 * OWNER (team: MATE) owns Pedro; OTHER owns Marta and Rosa; STRANGER owns nothing here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { session, OWNER, MATE, STRANGER, ADMIN } = mocks;
const OTHER = 'other-rescuer@example.com';

const { state, notify, faults } = vi.hoisted(() => ({
    state: { db: null as unknown },
    notify: { create: [] as Array<Record<string, unknown>>, admins: [] as Array<Record<string, unknown>> },
    faults: {
        afterEnsure: null as null | ((householdId: string) => void),
        afterAdd: null as null | ((householdId: string) => void),
    },
}));

vi.mock('./_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/config/admins', async (orig) => ({
    ...(await orig()),
    isAdminAsync: mocks.isAdmin,
    isModeratorOrAdminAsync: mocks.isAdmin,
}));
vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig()), isOrgMate: mocks.isOrgMate, getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor,
    isOwnerOrOrgMate: (v: string | null | undefined, o: string | null | undefined) => mocks.isOwnerOrOrgMate(v?.trim().toLowerCase(), o?.trim().toLowerCase()),
}));
// PII gating ON, so "not an approver / still masked" actually tests something.
vi.mock('@/config/features', async (orig) => ({
    ...(await orig()),
    getFeatureFlag: vi.fn(async (flag: string) => flag === 'ENABLE_PII_ACCESS_GATING'),
}));
// A racing caller dropping the household right after ensureHousehold / addMembership (Task 1 carry-over).
vi.mock('@/lib/households', async (orig) => {
    const real = await orig<typeof import('@/lib/households')>();
    return {
        ...real,
        ensureHousehold: vi.fn(async (...args: Parameters<typeof real.ensureHousehold>) => {
            const id = await real.ensureHousehold(...args);
            const hook = faults.afterEnsure; faults.afterEnsure = null; hook?.(id);
            return id;
        }),
        addMembership: vi.fn(async (...args: Parameters<typeof real.addMembership>) => {
            const out = await real.addMembership(...args);
            const hook = faults.afterAdd; faults.afterAdd = null; hook?.(args[1].householdId);
            return out;
        }),
    };
});
// The card enrichment chains D1-only promise calls the in-memory driver lacks; detection
// (findFormDuplicates → findAdopters 'duplicate', the real token index) stays real.
vi.mock('./hydrateDuplicateMatches', () => ({
    hydrateDuplicateMatches: vi.fn(async (_db: unknown, matches: Array<{ adopterId: string; adopterName: string; relevancePercent: number }>) =>
        matches.map(m => ({ adopter: { id: m.adopterId, name: m.adopterName }, relevancePercent: m.relevancePercent }))),
}));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
// Side effects run (not dropped): the notices and the access request are part of what is tested.
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async (_n: string, task: () => Promise<unknown>) => { await task(); }) }));
vi.mock('./notifications', () => ({
    createNotification: vi.fn(async (d: Record<string, unknown>) => { notify.create.push(d); return 'n'; }),
    notifyAdmins: vi.fn(async (d: Record<string, unknown>) => { notify.admins.push(d); }),
    resolveDisplayName: vi.fn(async (email: string) => email.split('@')[0]),
    resolveDisplayNames: vi.fn(async (emails: string[]) => Object.fromEntries(emails.map(e => [e, e.split('@')[0]]))),
}));
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
    withTrace: (_op: string, fn: () => unknown) => fn(),
}));

import { addHouseholdPerson, getHouseholdMatchCandidates, removeHouseholdMembership, updateHouseholdMembership } from './households';
import { getAdopterApprovers } from './piiAccess';
import { loadApprovers } from '@/lib/piiAccessRequest';
import { resolveAdopterVisibility } from '@/lib/piiAccessServer';
import { hashEntryValue } from '@/lib/piiAccess';
import { tokenizeAdopter } from '@/lib/adopterTokenize';
import { logger } from '@/lib/logger';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };

const LUCAS_PHONE = '+54 11 5555 0101';
const MARTA_PHONE = '+54 11 4444 0303';

const as = async <T>(user: string | null, fn: () => Promise<T>): Promise<T> => {
    const before = session.user;
    session.user = user;
    try { return await fn(); } finally { session.user = before; }
};
const profileNamed = (name: string) => sqlite.prepare('SELECT * FROM adopters WHERE name = ?').get(name);
const membershipsIn = (householdId: string) => sqlite.prepare('SELECT * FROM household_memberships WHERE household_id = ? ORDER BY added_at, id').all(householdId);
const historyOf = (adopterId: string) => sqlite.prepare('SELECT changed_by, kind, changes FROM adopter_history WHERE adopter_id = ? ORDER BY rowid').all(adopterId)
    .map(r => ({ ...r, changes: JSON.parse(r.changes as string) }));
const grantsOf = (adopterId: string, email: string) => sqlite.prepare('SELECT scope, origin, entry_ref FROM pii_access_grants WHERE adopter_id = ? AND grantee_email = ? AND revoked_at IS NULL').all(adopterId, email);
const noticesOfType = (type: string) => notify.create.filter(n => n.type === type);

/** Never an approver (owner or editor) of the profile: no authority over its requests and grants. */
async function expectNotApprover(email: string, adopterId: string) {
    expect((await loadApprovers(adopterId)).all, `${email} on ${adopterId}`).not.toContain(email);
    const { owner, editors } = await getAdopterApprovers(adopterId);
    expect([owner, ...editors], `${email} on ${adopterId}`).not.toContain(email);
    const addedBy = sqlite.prepare('SELECT added_by FROM adopters WHERE id = ?').get(adopterId)!.added_by as string;
    expect((await resolveAdopterVisibility(email, { id: adopterId, addedBy })).nothingMasked).toBe(false);
}

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    notify.create.length = 0;
    notify.admins.length = 0;
    faults.afterEnsure = null;
    faults.afterAdd = null;
    vi.mocked(logger.warn).mockClear();
    session.user = STRANGER;
    const insert = sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at, contact_entries) VALUES (?, ?, '5', ?, 1000, 1000, ?)`);
    insert.run('pedro', 'Pedro Paez', OWNER, null);
    insert.run('marta', 'Marta Paez', OTHER, JSON.stringify([{ id: 'mc', type: 'phone', value: MARTA_PHONE, addedBy: OTHER }]));
    insert.run('rosa', 'Rosa Diaz', OTHER, null);
});

async function strangerAddsLucas() {
    const res = await addHouseholdPerson({
        anchorAdopterId: 'pedro', name: 'Lucas Paez', relationship: 'child', age: 12,
        contactEntries: [{ type: 'phone', value: LUCAS_PHONE }],
    });
    if (!res.ok) throw new Error(res.error);
    return res;
}

describe('addHouseholdPerson — a new person', () => {
    it("a stranger adds Lucas: Pedro's owner owns him, the phone is the stranger's with a grant, contributions only, Pedro's team told", async () => {
        const res = await strangerAddsLucas();
        expect(res).toMatchObject({ ok: true, createdProfile: true, autoRequestFiled: true });

        const lucas = profileNamed('Lucas Paez')!;
        expect(lucas.id).toBe(res.profileId);
        expect(lucas).toMatchObject({ added_by: OWNER, age: 12, is_minor: 1, is_public: 0, deleted_at: null });
        expect(lucas.age_as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(JSON.parse(lucas.contact_entries as string)).toEqual([expect.objectContaining({ type: 'phone', value: LUCAS_PHONE, addedBy: STRANGER })]);
        expect(lucas.contact_info).toContain(LUCAS_PHONE);

        // The membership: in Pedro's household, next to Pedro, credited to the stranger.
        const members = membershipsIn('hh-pedro');
        expect(members.map(m => m.adopter_id)).toEqual(['pedro', res.profileId]);
        expect(members[1]).toMatchObject({ id: res.membershipId, relationship: 'child', relative_to_adopter_id: 'pedro', added_by: STRANGER, gift_recipient: 0 });

        // The phone unlocks for the one who typed it.
        expect(grantsOf(res.profileId, STRANGER)).toEqual([{ scope: 'entry', origin: 'contribution', entry_ref: hashEntryValue('phone', LUCAS_PHONE) }]);

        // History: contributions on both profiles, never 'edit'.
        const lucasHistory = historyOf(res.profileId);
        expect(lucasHistory).toHaveLength(1);
        expect(lucasHistory[0]).toMatchObject({ changed_by: STRANGER, kind: 'contribution' });
        expect(lucasHistory[0].changes).toEqual({ created_in_household: expect.objectContaining({ householdId: 'hh-pedro', anchorId: 'pedro', anchorName: 'Pedro Paez', contactTypes: ['phone'] }) });
        const pedroHistory = historyOf('pedro');
        expect(pedroHistory).toEqual([expect.objectContaining({ changed_by: STRANGER, kind: 'contribution' })]);
        expect(pedroHistory[0].changes).toEqual({ household_member_added: { id: res.membershipId, householdId: 'hh-pedro', profileId: res.profileId, relationship: 'child', contactTypes: ['phone'] } });

        // Pedro's owner hears about it (D54), the stranger doesn't.
        const notices = noticesOfType('household_contribution');
        expect(notices.map(n => n.userId)).toEqual([OWNER]);
        expect(notices[0]).toMatchObject({ url: '/adopter/pedro', metadata: expect.objectContaining({ adopterId: 'pedro', contributor: STRANGER, membershipId: res.membershipId, profileId: res.profileId }) });
        expect(notify.create.some(n => n.userId === STRANGER)).toBe(false);

        // The access request is filed for them, on the profile that holds the phone.
        expect(sqlite.prepare('SELECT requester_email, status, justification FROM pii_access_requests WHERE adopter_id = ?').all(res.profileId))
            .toEqual([{ requester_email: STRANGER, status: 'pending', justification: 'auto:contribution' }]);

        await expectNotApprover(STRANGER, 'pedro');
        await expectNotApprover(STRANGER, res.profileId);
    });

    it("the owner adding to their own profile: 'edit' history, no grant, no notice to their own team", async () => {
        const res = await as(OWNER, () => addHouseholdPerson({ anchorAdopterId: 'pedro', name: 'Lucas Paez', contactEntries: [{ type: 'phone', value: LUCAS_PHONE }] }));
        if (!res.ok) throw new Error(res.error);
        expect(res).toMatchObject({ createdProfile: true, autoRequestFiled: false });
        expect(historyOf(res.profileId)[0]).toMatchObject({ changed_by: OWNER, kind: 'edit' });
        expect(historyOf('pedro')[0]).toMatchObject({ changed_by: OWNER, kind: 'edit' });
        expect(grantsOf(res.profileId, OWNER)).toEqual([]);
        expect(notify.create).toEqual([]);
        // An unknown relationship is stored as 'unknown' and still labelled next to Pedro.
        expect(membershipsIn('hh-pedro')[1]).toMatchObject({ relationship: 'unknown', relative_to_adopter_id: 'pedro' });
    });

    it('a relationship alone (no name, no contact) is refused, and nothing is written', async () => {
        const res = await addHouseholdPerson({ anchorAdopterId: 'pedro', relationship: 'child' });
        expect(res).toEqual({ ok: false, error: 'identifier_required' });
        // An alias is not an identifier either.
        expect(await addHouseholdPerson({ anchorAdopterId: 'pedro', relationship: 'child', contactEntries: [{ type: 'alias', value: 'Luqui' }] }))
            .toEqual({ ok: false, error: 'identifier_required' });
        expect(sqlite.prepare('SELECT COUNT(*) AS n FROM adopters').get()!.n).toBe(3);
        expect(sqlite.prepare('SELECT COUNT(*) AS n FROM household_memberships').get()!.n).toBe(0);
        expect(sqlite.prepare('SELECT COUNT(*) AS n FROM households').get()!.n).toBe(0);
    });

    it('a contact alone is enough (nameless person)', async () => {
        const res = await addHouseholdPerson({ anchorAdopterId: 'pedro', contactEntries: [{ type: 'phone', value: LUCAS_PHONE }] });
        expect(res).toMatchObject({ ok: true, createdProfile: true });
    });

    it('refuses without a session, on a missing or deleted anchor, and on a malformed contact', async () => {
        expect(await as(null, () => addHouseholdPerson({ anchorAdopterId: 'pedro', name: 'Lucas Paez' }))).toEqual({ ok: false, error: 'not_authenticated' });
        expect(await addHouseholdPerson({ anchorAdopterId: 'nobody', name: 'Lucas Paez' })).toEqual({ ok: false, error: 'not_found' });
        sqlite.prepare(`UPDATE adopters SET deleted_at = 5000 WHERE id = 'rosa'`).run();
        expect(await addHouseholdPerson({ anchorAdopterId: 'rosa', name: 'Lucas Paez' })).toEqual({ ok: false, error: 'not_found' });
        expect(await addHouseholdPerson({ anchorAdopterId: 'pedro', name: 'Lucas Paez', contactEntries: [{ type: 'fax' as 'phone', value: '1' }] }))
            .toEqual({ ok: false, error: 'invalid' });
        expect(sqlite.prepare('SELECT COUNT(*) AS n FROM household_memberships').get()!.n).toBe(0);
    });

    it("a chosen household must be one the anchor is in (a guessed id is refused)", async () => {
        const { profileId } = await strangerAddsLucas();
        // Rosa's own household, which Pedro is not in.
        const rosas = await as(OTHER, () => addHouseholdPerson({ anchorAdopterId: 'rosa', existingProfileId: 'marta' }));
        if (!rosas.ok) throw new Error(rosas.error);
        const rosaHousehold = sqlite.prepare(`SELECT household_id FROM household_memberships WHERE adopter_id = 'rosa'`).get()!.household_id as string;
        expect(await addHouseholdPerson({ anchorAdopterId: 'pedro', householdId: rosaHousehold, existingProfileId: profileId }))
            .toEqual({ ok: false, error: 'not_found' });
        expect(membershipsIn(rosaHousehold).map(m => m.adopter_id).sort()).toEqual(['marta', 'rosa']);
        // Pedro's own household, chosen explicitly, works.
        const ok = await addHouseholdPerson({ anchorAdopterId: 'pedro', householdId: 'hh-pedro', existingProfileId: 'rosa' });
        expect(ok).toMatchObject({ ok: true, createdProfile: false });
        expect(membershipsIn('hh-pedro').map(m => m.adopter_id)).toEqual(['pedro', profileId, 'rosa']);
    });

    it('a gift recipient gets a gift household of its own (recipient first), never the ordinary one', async () => {
        await strangerAddsLucas();
        const res = await addHouseholdPerson({ anchorAdopterId: 'pedro', name: 'Ana Regalo', giftRecipient: true, householdId: 'hh-pedro' });
        if (!res.ok) throw new Error(res.error);
        const gift = sqlite.prepare('SELECT household_id FROM household_memberships WHERE adopter_id = ?').get(res.profileId)!.household_id as string;
        expect(gift).not.toBe('hh-pedro');
        expect(membershipsIn(gift).map(m => [m.adopter_id, m.gift_recipient])).toEqual([[res.profileId, 1], ['pedro', 0]]);
        // The ordinary household is untouched (still no gift membership in it).
        expect(membershipsIn('hh-pedro').every(m => m.gift_recipient === 0)).toBe(true);
    });
});

describe('addHouseholdPerson — an existing profile («¿Es este perfil?» → sí)', () => {
    it('links Marta and puts the typed phone on her profile once, through addContactEntry', async () => {
        const first = await addHouseholdPerson({ anchorAdopterId: 'pedro', existingProfileId: 'marta', relationship: 'partner', contactEntries: [{ type: 'phone', value: LUCAS_PHONE }] });
        expect(first).toMatchObject({ ok: true, profileId: 'marta', createdProfile: false, autoRequestFiled: true });
        const again = await addHouseholdPerson({ anchorAdopterId: 'pedro', existingProfileId: 'marta', relationship: 'partner', contactEntries: [{ type: 'phone', value: LUCAS_PHONE }] });
        expect(again).toMatchObject({ ok: true, profileId: 'marta', createdProfile: false });
        if (!first.ok || !again.ok) throw new Error('add failed');
        expect(again.membershipId).toBe(first.membershipId);

        const entries = JSON.parse(profileNamed('Marta Paez')!.contact_entries as string) as Array<{ type: string; value: string; addedBy?: string }>;
        expect(entries.filter(e => e.value === LUCAS_PHONE)).toEqual([expect.objectContaining({ type: 'phone', addedBy: STRANGER })]);
        expect(entries).toHaveLength(2);
        expect(grantsOf('marta', STRANGER)).toEqual([expect.objectContaining({ origin: 'contribution', entry_ref: hashEntryValue('phone', LUCAS_PHONE) })]);
        expect(membershipsIn('hh-pedro').map(m => m.adopter_id)).toEqual(['pedro', 'marta']);
        // No new profile.
        expect(sqlite.prepare('SELECT COUNT(*) AS n FROM adopters').get()!.n).toBe(3);

        // Marta's team hears that she now shows as living with Pedro — once, not on the repeat.
        const linked = noticesOfType('household_linked');
        expect(linked.map(n => n.userId)).toEqual([OTHER]);
        expect(linked[0]).toMatchObject({ url: '/adopter/marta', template: { key: 'household_linked', params: expect.objectContaining({ hostName: 'Pedro Paez', linkedName: 'Marta Paez' }) } });
        // Marta's history says she joined Pedro's household (a contribution: no standing on her).
        expect(historyOf('marta').find(h => 'household_joined' in h.changes)).toMatchObject({ changed_by: STRANGER, kind: 'contribution', changes: { household_joined: expect.objectContaining({ hostId: 'pedro', hostName: 'Pedro Paez' }) } });
        await expectNotApprover(STRANGER, 'marta');
    });

    it("refuses the anchor itself and a deleted profile", async () => {
        expect(await addHouseholdPerson({ anchorAdopterId: 'pedro', existingProfileId: 'pedro' })).toEqual({ ok: false, error: 'not_found' });
        sqlite.prepare(`UPDATE adopters SET deleted_at = 5000 WHERE id = 'rosa'`).run();
        expect(await addHouseholdPerson({ anchorAdopterId: 'pedro', existingProfileId: 'rosa' })).toEqual({ ok: false, error: 'not_found' });
        expect(sqlite.prepare('SELECT COUNT(*) AS n FROM household_memberships').get()!.n).toBe(0);
    });

    it("the other households Marta already lives in are told she now lives with Pedro too", async () => {
        await as(OTHER, () => addHouseholdPerson({ anchorAdopterId: 'rosa', existingProfileId: 'marta' }));
        notify.create.length = 0;
        await as(OWNER, () => addHouseholdPerson({ anchorAdopterId: 'pedro', existingProfileId: 'marta' }));
        // OTHER owns Marta (told via household_linked) and Rosa (told once, not twice).
        expect(notify.create.filter(n => n.userId === OTHER)).toHaveLength(1);
        notify.create.length = 0;
        sqlite.prepare(`UPDATE adopters SET added_by = ? WHERE id = 'rosa'`).run(ADMIN);
        await as(OWNER, () => addHouseholdPerson({ anchorAdopterId: 'pedro', existingProfileId: 'rosa' }));
        // Rosa now lives in Rosa's household (with Marta) and Pedro's. Marta's owner hears via the Pedro household (household_linked) — Rosa's owner too.
        expect(noticesOfType('household_linked').map(n => n.userId).sort()).toEqual([ADMIN, OTHER].sort());
    });

    it("the other household's teams get «también vive con» when they are nobody else's team", async () => {
        // Marta lives with Rosa (both OTHER's); Rosa's household gains STRANGER-owned Luz.
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('luz', 'Luz Diaz', '5', ?, 1000, 1000)`).run(STRANGER);
        await as(OTHER, () => addHouseholdPerson({ anchorAdopterId: 'rosa', existingProfileId: 'marta' }));
        await as(OTHER, () => addHouseholdPerson({ anchorAdopterId: 'rosa', existingProfileId: 'luz' }));
        notify.create.length = 0;
        await as(OWNER, () => addHouseholdPerson({ anchorAdopterId: 'pedro', existingProfileId: 'marta' }));
        const also = noticesOfType('household_also_lives_with');
        expect(also.map(n => n.userId)).toEqual([STRANGER]);
        expect(also[0]).toMatchObject({ template: { key: 'household_also_lives_with', params: expect.objectContaining({ personName: 'Marta Paez', hostName: 'Pedro Paez' }) } });
    });
});

describe('re-adding after «No vive acá» (dispute, D48)', () => {
    it('adds anyway and tells the admins, once', async () => {
        const added = await as(OWNER, () => addHouseholdPerson({ anchorAdopterId: 'pedro', existingProfileId: 'marta' }));
        if (!added.ok) throw new Error(added.error);
        expect(await as(OTHER, () => removeHouseholdMembership({ membershipId: added.membershipId, reason: 'not_living' }))).toMatchObject({ ok: true });
        expect(notify.admins).toEqual([]);

        const back = await addHouseholdPerson({ anchorAdopterId: 'pedro', existingProfileId: 'marta' });
        expect(back).toMatchObject({ ok: true, profileId: 'marta' });
        expect(membershipsIn('hh-pedro').map(m => m.adopter_id)).toEqual(['pedro', 'marta']);
        expect(notify.admins).toHaveLength(1);
        expect(notify.admins[0]).toMatchObject({
            actorEmail: STRANGER, type: 'household_member_disputed', url: '/adopter/marta',
            template: { key: 'household_member_disputed', params: expect.objectContaining({ personName: 'Marta Paez', hostName: 'Pedro Paez' }) },
        });
        // An idempotent repeat is silent.
        await addHouseholdPerson({ anchorAdopterId: 'pedro', existingProfileId: 'marta' });
        expect(notify.admins).toHaveLength(1);
    });

    it("a «Lo cargué por error» removal is no dispute on re-add", async () => {
        const added = await as(OWNER, () => addHouseholdPerson({ anchorAdopterId: 'pedro', existingProfileId: 'marta' }));
        if (!added.ok) throw new Error(added.error);
        await as(OWNER, () => removeHouseholdMembership({ membershipId: added.membershipId, reason: 'mistake' }));
        await as(OWNER, () => addHouseholdPerson({ anchorAdopterId: 'pedro', existingProfileId: 'marta' }));
        expect(notify.admins).toEqual([]);
    });
});

describe('removeHouseholdMembership — who may', () => {
    it("a stranger who didn't add it ✗; the adder ✓", async () => {
        const { membershipId } = await strangerAddsLucas();
        expect(await as(OTHER, () => removeHouseholdMembership({ membershipId, reason: 'mistake' }))).toEqual({ ok: false, error: 'not_authorized' });
        expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(expect.stringContaining('removeHouseholdMembership'), expect.objectContaining({ membershipId, actor: OTHER }));
        expect(membershipsIn('hh-pedro')).toHaveLength(2);
        expect(await removeHouseholdMembership({ membershipId, reason: 'mistake' })).toEqual({ ok: true, correctionId: null });
        expect(membershipsIn('hh-pedro').map(m => m.adopter_id)).toEqual(['pedro']);
        // No correction, the profile stays.
        expect(sqlite.prepare('SELECT COUNT(*) AS n FROM household_corrections').get()!.n).toBe(0);
        expect(profileNamed('Lucas Paez')).toMatchObject({ deleted_at: null });
    });

    it("a housemate's team ✓ (MATE, Pedro's owner's teammate)", async () => {
        const { membershipId } = await strangerAddsLucas();
        expect(await as(MATE, () => removeHouseholdMembership({ membershipId, reason: 'mistake' }))).toMatchObject({ ok: true });
    });

    it("Marta's own team ✓ and an admin ✓; a missing id or a bad reason ✗", async () => {
        const a = await as(OWNER, () => addHouseholdPerson({ anchorAdopterId: 'pedro', existingProfileId: 'marta' }));
        const b = await as(OWNER, () => addHouseholdPerson({ anchorAdopterId: 'pedro', existingProfileId: 'rosa' }));
        if (!a.ok || !b.ok) throw new Error('add failed');
        expect(await as(OTHER, () => removeHouseholdMembership({ membershipId: a.membershipId, reason: 'mistake' }))).toMatchObject({ ok: true });
        expect(await as(ADMIN, () => removeHouseholdMembership({ membershipId: b.membershipId, reason: 'mistake' }))).toMatchObject({ ok: true });
        expect(await as(ADMIN, () => removeHouseholdMembership({ membershipId: 'hm-nope', reason: 'mistake' }))).toEqual({ ok: false, error: 'not_found' });
        expect(await as(ADMIN, () => removeHouseholdMembership({ membershipId: b.membershipId, reason: 'gone' as 'mistake' }))).toEqual({ ok: false, error: 'invalid' });
        expect(await as(null, () => removeHouseholdMembership({ membershipId: b.membershipId, reason: 'mistake' }))).toEqual({ ok: false, error: 'not_authenticated' });
    });
});

describe('removeHouseholdMembership — «No vive acá»', () => {
    it('writes a correction and history on both profiles; the other teams are told', async () => {
        const added = await as(OWNER, () => addHouseholdPerson({ anchorAdopterId: 'pedro', existingProfileId: 'marta', relationship: 'partner' }));
        if (!added.ok) throw new Error(added.error);
        notify.create.length = 0;

        const res = await as(OWNER, () => removeHouseholdMembership({ membershipId: added.membershipId, reason: 'not_living' }));
        expect(res).toMatchObject({ ok: true, correctionId: expect.stringMatching(/^hc-/) });
        const corr = sqlite.prepare('SELECT * FROM household_corrections').all();
        expect(corr).toEqual([expect.objectContaining({ household_id: 'hh-pedro', adopter_id: 'marta', corrected_by: OWNER })]);
        expect(membershipsIn('hh-pedro').map(m => m.adopter_id)).toEqual(['pedro']);

        // History on both — 'edit' on Pedro (OWNER's own), 'contribution' on Marta (OTHER's).
        expect(historyOf('pedro').at(-1)).toMatchObject({ changed_by: OWNER, kind: 'edit', changes: { household_member_removed: { id: added.membershipId, householdId: 'hh-pedro', reason: 'not_living_together', linkedId: 'marta' } } });
        expect(historyOf('marta').at(-1)).toMatchObject({ changed_by: OWNER, kind: 'contribution', changes: { household_not_living_together: { hostId: 'pedro', hostName: 'Pedro Paez', householdId: 'hh-pedro' } } });

        // Marta's team and Pedro's team hear it — never the actor.
        const removed = noticesOfType('household_member_removed');
        expect(removed.map(n => n.userId).sort()).toEqual([MATE, OTHER].sort());
        expect(removed[0]).toMatchObject({ template: { key: 'household_member_removed', params: expect.objectContaining({ personName: 'Marta Paez', hostName: 'Pedro Paez', reason: 'not_living' }) } });
    });

    it('«Lo cargué por error»: no correction, history says so on the person and the housemates', async () => {
        const { membershipId, profileId } = await strangerAddsLucas();
        await removeHouseholdMembership({ membershipId, reason: 'mistake' });
        expect(historyOf('pedro').at(-1)).toMatchObject({ changed_by: STRANGER, kind: 'contribution', changes: { household_member_removed: { id: membershipId, householdId: 'hh-pedro', reason: 'mistake', linkedId: profileId } } });
        expect(historyOf(profileId).at(-1)).toMatchObject({ changed_by: STRANGER, kind: 'contribution', changes: { household_removed_by_host: { hostId: 'pedro', hostName: 'Pedro Paez', householdId: 'hh-pedro', reason: 'mistake' } } });
        await expectNotApprover(STRANGER, 'pedro');
    });
});

describe('updateHouseholdMembership — the relationship', () => {
    it('anyone signed in: credited, history on the person, the household teams told', async () => {
        const added = await as(OWNER, () => addHouseholdPerson({ anchorAdopterId: 'pedro', existingProfileId: 'marta', relationship: 'sibling' }));
        if (!added.ok) throw new Error(added.error);
        notify.create.length = 0;

        expect(await updateHouseholdMembership({ membershipId: added.membershipId, relationship: 'partner' })).toEqual({ ok: true });
        expect(membershipsIn('hh-pedro')[1]).toMatchObject({ relationship: 'partner', added_by: OWNER });
        expect(historyOf('marta').at(-1)).toMatchObject({ changed_by: STRANGER, kind: 'contribution', changes: { household_relationship_changed: { membershipId: added.membershipId, householdId: 'hh-pedro', from: 'sibling', to: 'partner' } } });
        const notices = noticesOfType('household_relationship_changed');
        expect(notices.map(n => n.userId).sort()).toEqual([MATE, OTHER, OWNER].sort());
        expect(notices[0]).toMatchObject({ template: { key: 'household_relationship_changed', params: expect.objectContaining({ personName: 'Marta Paez', relationship: 'partner', relativeName: 'Pedro Paez' }) } });
        await expectNotApprover(STRANGER, 'marta');
    });

    it('same value is a no-op; a stale `expected` is a conflict; bad input / no session / missing ✗', async () => {
        const added = await as(OWNER, () => addHouseholdPerson({ anchorAdopterId: 'pedro', existingProfileId: 'marta', relationship: 'sibling' }));
        if (!added.ok) throw new Error(added.error);
        const before = historyOf('marta').length;
        expect(await updateHouseholdMembership({ membershipId: added.membershipId, relationship: 'sibling' })).toEqual({ ok: true });
        expect(historyOf('marta')).toHaveLength(before);
        expect(await updateHouseholdMembership({ membershipId: added.membershipId, relationship: 'child', expected: 'partner' })).toEqual({ ok: false, error: 'conflict' });
        expect(membershipsIn('hh-pedro')[1].relationship).toBe('sibling');
        expect(await updateHouseholdMembership({ membershipId: added.membershipId, relationship: 'cousin' as 'child' })).toEqual({ ok: false, error: 'invalid' });
        expect(await updateHouseholdMembership({ membershipId: 'hm-nope', relationship: 'child' })).toEqual({ ok: false, error: 'not_found' });
        expect(await as(null, () => updateHouseholdMembership({ membershipId: added.membershipId, relationship: 'child' }))).toEqual({ ok: false, error: 'not_authenticated' });
    });
});

describe('a household dropped by a racing caller (Task 1 carry-over)', () => {
    const dropHousehold = (id: string) => {
        sqlite.prepare('DELETE FROM household_memberships WHERE household_id = ?').run(id);
        sqlite.prepare('DELETE FROM households WHERE id = ?').run(id);
    };

    it('ensureHousehold returned a dropped id: retried once, no dangling membership', async () => {
        faults.afterEnsure = dropHousehold;
        const res = await strangerAddsLucas();
        const dangling = sqlite.prepare('SELECT m.id FROM household_memberships m LEFT JOIN households h ON h.id = m.household_id WHERE h.id IS NULL').all();
        expect(dangling).toEqual([]);
        const hh = sqlite.prepare('SELECT household_id FROM household_memberships WHERE id = ?').get(res.membershipId)!.household_id as string;
        expect(membershipsIn(hh).map(m => m.adopter_id)).toEqual(['pedro', res.profileId]);
        expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(expect.stringContaining('household gone'), expect.objectContaining({ anchorId: 'pedro', actor: STRANGER }));
    });

    it('dropped right after the membership landed: the membership is taken back and placed again', async () => {
        faults.afterAdd = dropHousehold;
        const res = await strangerAddsLucas();
        const dangling = sqlite.prepare('SELECT m.id FROM household_memberships m LEFT JOIN households h ON h.id = m.household_id WHERE h.id IS NULL').all();
        expect(dangling).toEqual([]);
        expect(sqlite.prepare('SELECT COUNT(*) AS n FROM household_memberships WHERE adopter_id = ?').get(res.profileId)!.n).toBe(1);
    });

    it('a chosen household that is gone is not_found (never recreated)', async () => {
        await strangerAddsLucas();
        faults.afterAdd = null;
        dropHousehold('hh-pedro');
        expect(await addHouseholdPerson({ anchorAdopterId: 'pedro', householdId: 'hh-pedro', existingProfileId: 'rosa' })).toEqual({ ok: false, error: 'not_found' });
    });
});

describe('getHouseholdMatchCandidates — «¿Es este perfil?»', () => {
    beforeEach(async () => {
        await tokenizeAdopter('marta');
        await tokenizeAdopter('pedro');
        await tokenizeAdopter('rosa');
        // Marta lives with Rosa.
        await as(OTHER, () => addHouseholdPerson({ anchorAdopterId: 'rosa', existingProfileId: 'marta' }));
    });

    it("the «Nuevo adoptante» duplicate check, plus each candidate's household line", async () => {
        const { results } = await getHouseholdMatchCandidates({ name: 'Marta Paez', contactEntries: [{ type: 'phone', value: MARTA_PHONE }], anchorAdopterId: 'pedro' });
        const marta = results.find(r => r.adopter.id === 'marta');
        expect(marta).toBeTruthy();
        expect(marta!.householdLine).toEqual([expect.objectContaining({ profileId: 'rosa', name: 'Rosa Diaz', isGift: false })]);
        // The anchor is never its own candidate.
        expect(results.some(r => r.adopter.id === 'pedro')).toBe(false);
    });

    it('a phone alone finds her (no name typed)', async () => {
        const { results } = await getHouseholdMatchCandidates({ contactEntries: [{ type: 'phone', value: MARTA_PHONE }], anchorAdopterId: 'pedro' });
        expect(results.map(r => r.adopter.id)).toContain('marta');
    });

    it('nothing to match on, or no session → no candidates', async () => {
        expect(await getHouseholdMatchCandidates({ name: 'M' })).toEqual({ results: [] });
        expect(await as(null, () => getHouseholdMatchCandidates({ name: 'Marta Paez' }))).toEqual({ results: [] });
    });
});
