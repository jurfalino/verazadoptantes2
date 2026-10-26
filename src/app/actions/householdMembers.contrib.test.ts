/**
 * Open household contributions (spec 2026-10-25 pendientes D, D54). Real SQL,
 * the real household actions, the real visibility resolver, the real
 * getAdopter masking; the session is the only source of the actor.
 * OWNER (team: MATE) owns the profile; STRANGER and OTHER are unrelated rescuers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { session, OWNER, MATE, STRANGER } = mocks;
const OTHER = 'other-rescuer@example.com';

const { state, notify, faults } = vi.hoisted(() => ({
    faults: { beforeCas: null as null | (() => void) },
    state: { db: null as unknown },
    notify: { create: [] as Array<Record<string, unknown>> },
}));

vi.mock('./_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/config/admins', () => ({ isAdminAsync: mocks.isAdmin, isModeratorOrAdminAsync: mocks.isAdmin }));
vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig()), isOrgMate: mocks.isOrgMate, getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor,
    isOwnerOrOrgMate: (v: string | null | undefined, o: string | null | undefined) => mocks.isOwnerOrOrgMate(v?.trim().toLowerCase(), o?.trim().toLowerCase()),
}));
// PII gating ON, so "a stranger sees it masked" actually tests masking.
vi.mock('@/config/features', async (orig) => ({
    ...(await orig()),
    getFeatureFlag: vi.fn(async (flag: string) => flag === 'ENABLE_PII_ACCESS_GATING'),
}));
// A write landing between the load and the compare-and-swap (the permission must follow it).
vi.mock('@/lib/adopterListCas', async (orig) => {
    const real = await orig<typeof import('@/lib/adopterListCas')>();
    return {
        ...real,
        casAdopterLists: vi.fn(async (...args: Parameters<typeof real.casAdopterLists>) => {
            const hook = faults.beforeCas; faults.beforeCas = null; hook?.();
            return real.casAdopterLists(...args);
        }),
    };
});
vi.mock('@/lib/adopterTokenize', () => ({ tokenizeAdopter: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
// Side effects run (not dropped): the notices and the access request are part of what is tested.
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async (_n: string, task: () => Promise<unknown>) => { await task(); }) }));
vi.mock('./notifications', () => ({
    createNotification: vi.fn(async (d: Record<string, unknown>) => { notify.create.push(d); return 'n'; }),
    notifyAdmins: vi.fn(async () => undefined),
    resolveDisplayName: vi.fn(async (email: string) => email.split('@')[0]),
    resolveDisplayNames: vi.fn(async (emails: string[]) => Object.fromEntries(emails.map(e => [e, e.split('@')[0]]))),
}));
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
    withTrace: (_op: string, fn: () => unknown) => fn(),
}));

import {
    addHouseholdMember, updateHouseholdMember, removeHouseholdMember,
    addMemberContactEntry, updateMemberContactEntry, removeMemberContactEntry,
} from './householdMembers';
import { resolveAdopterVisibility } from '@/lib/piiAccessServer';
import { hashEntryValue } from '@/lib/piiAccess';
import { deserializeHouseholdMembers, type HouseholdMember } from '@/lib/householdMembers';
import { logger } from '@/lib/logger';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };

const NOT_AUTHORIZED = 'Not authorized to edit this household.';
const OWNER_PHONE = '+54 11 4444 0303';
const STRANGER_PHONE = '+54 11 5555 0101';

const members = (): HouseholdMember[] =>
    deserializeHouseholdMembers((sqlite.prepare(`SELECT household_members FROM adopters WHERE id = 'p1'`).get()!.household_members as string) ?? null);
const member = (id: string) => members().find(m => m.id === id);
const history = () => sqlite.prepare(`SELECT changed_by, kind, changes FROM adopter_history WHERE adopter_id = 'p1' ORDER BY rowid`).all();
const grants = (email: string) => sqlite.prepare(`SELECT scope, origin, entry_ref FROM pii_access_grants WHERE adopter_id = 'p1' AND grantee_email = ? AND revoked_at IS NULL`).all(email);
const contributionNotices = () => notify.create.filter(n => n.type === 'household_contribution');

const as = async <T>(user: string | null, fn: () => Promise<T>): Promise<T> => {
    const before = session.user;
    session.user = user;
    try { return await fn(); } finally { session.user = before; }
};

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    notify.create.length = 0;
    faults.beforeCas = null;
    vi.mocked(logger.warn).mockClear();
    session.user = STRANGER;
    const household = [
        { id: 'om', name: 'Marta Paez', relationship: 'partner', addedBy: OWNER, contactEntries: [{ id: 'oc', type: 'phone', value: OWNER_PHONE, addedBy: OWNER }] },
        { id: 'lm', name: 'Lucas Paez', relationship: 'child', contactEntries: [] },
    ];
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at, household_members) VALUES ('p1', 'Pedro Paez', '5', ?, 1000, 1000, ?)`)
        .run(OWNER, JSON.stringify(household));
});

async function strangerAddsMember(): Promise<string> {
    const res = await addHouseholdMember({ adopterId: 'p1', name: 'Rosa Gomez', relationship: 'sibling', contactEntries: [{ type: 'phone', value: STRANGER_PHONE }] });
    if (!res.ok) throw new Error(res.error);
    return res.memberId;
}

describe('a stranger adds a member (D54)', () => {
    it('is saved credited to them, as a contribution, with an entry grant, the owner told and an access request filed', async () => {
        const memberId = await strangerAddsMember();

        const saved = member(memberId)!;
        expect(saved).toMatchObject({ name: 'Rosa Gomez', relationship: 'sibling', addedBy: STRANGER });
        expect(saved.contactEntries).toEqual([expect.objectContaining({ type: 'phone', value: STRANGER_PHONE, addedBy: STRANGER })]);

        const rows = history();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ changed_by: STRANGER, kind: 'contribution' });
        expect(JSON.parse(rows[0].changes as string)).toEqual({ household_member_added: { id: memberId, relationship: 'sibling', contactTypes: ['phone'] } });

        expect(grants(STRANGER)).toEqual([{ scope: 'entry', origin: 'contribution', entry_ref: hashEntryValue('phone', STRANGER_PHONE) }]);

        const notices = contributionNotices();
        expect(notices.map(n => n.userId)).toEqual([OWNER]);
        expect(notices[0]).toMatchObject({ url: '/adopter/p1', metadata: expect.objectContaining({ adopterId: 'p1', contributor: STRANGER, memberId }) });
        expect((notices[0].template as { key: string; params: Record<string, string> })).toMatchObject({ key: 'household_contribution', params: expect.objectContaining({ what: 'member', adopterName: 'Pedro Paez' }) });

        const requests = sqlite.prepare(`SELECT requester_email, status, justification FROM pii_access_requests WHERE adopter_id = 'p1'`).all();
        expect(requests).toEqual([{ requester_email: STRANGER, status: 'pending', justification: 'auto:contribution' }]);

        // Contributing never makes them an editor (full contact access).
        expect((await resolveAdopterVisibility(STRANGER, { id: 'p1', addedBy: OWNER })).nothingMasked).toBe(false);
    });

    it('their member shows its name and phone to them; to another stranger both stay protected', async () => {
        const memberId = await strangerAddsMember();
        const { getAdopter } = await import('./adopters');

        const mine = deserializeHouseholdMembers((await as(STRANGER, () => getAdopter('p1')))!.householdMembers);
        const myMember = mine.find(m => m.id === memberId)!;
        expect(myMember.name).toBe('Rosa Gomez');
        expect(myMember.contactEntries[0]).toMatchObject({ value: STRANGER_PHONE });
        expect(myMember.contactEntries[0].masked).toBeFalsy();
        // The owner's member stays protected for them.
        expect(mine.find(m => m.id === 'om')!.name).toBe('M P');
        expect(mine.find(m => m.id === 'om')!.contactEntries[0].masked).toBe(true);

        const theirs = deserializeHouseholdMembers((await as(OTHER, () => getAdopter('p1')))!.householdMembers);
        const seen = theirs.find(m => m.id === memberId)!;
        expect(seen.name).toBe('R G');
        expect(seen.contactEntries[0].masked).toBe(true);
        expect(seen.contactEntries[0].value).not.toBe(STRANGER_PHONE);
    });

    it('the viewer match is case-insensitive', async () => {
        const memberId = await strangerAddsMember();
        const { getAdopter } = await import('./adopters');
        const mine = deserializeHouseholdMembers((await as(STRANGER.toUpperCase(), () => getAdopter('p1')))!.householdMembers);
        expect(mine.find(m => m.id === memberId)!.name).toBe('Rosa Gomez');
    });
});

describe('a stranger edits / removes members', () => {
    it('their own member: edit ✓ and remove ✓, both as contributions; still not an editor', async () => {
        const memberId = await strangerAddsMember();
        expect(await updateHouseholdMember({ adopterId: 'p1', memberId, name: 'Rosa M. Gomez', age: 30 })).toEqual({ ok: true });
        expect(member(memberId)).toMatchObject({ name: 'Rosa M. Gomez', age: 30, addedBy: STRANGER });
        expect(await removeHouseholdMember({ adopterId: 'p1', memberId })).toEqual({ ok: true });
        expect(member(memberId)).toBeUndefined();
        expect(history().map(h => h.kind)).toEqual(['contribution', 'contribution', 'contribution']);
        expect((await resolveAdopterVisibility(STRANGER, { id: 'p1', addedBy: OWNER })).nothingMasked).toBe(false);
    });

    it("someone else's member ✗ (owner-added and another stranger's), logged with context", async () => {
        const memberId = await strangerAddsMember();
        expect(await updateHouseholdMember({ adopterId: 'p1', memberId: 'om', name: 'X' })).toEqual({ ok: false, error: NOT_AUTHORIZED });
        expect(await removeHouseholdMember({ adopterId: 'p1', memberId: 'om' })).toEqual({ ok: false, error: NOT_AUTHORIZED });
        expect(await as(OTHER, () => updateHouseholdMember({ adopterId: 'p1', memberId, name: 'X' }))).toEqual({ ok: false, error: NOT_AUTHORIZED });
        expect(await as(OTHER, () => removeHouseholdMember({ adopterId: 'p1', memberId }))).toEqual({ ok: false, error: NOT_AUTHORIZED });
        expect(member('om')!.name).toBe('Marta Paez');
        expect(member(memberId)!.name).toBe('Rosa Gomez');
        expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ adopterId: 'p1', actor: STRANGER, memberId: 'om' }));
    });

    it('a legacy member (no addedBy) ✗', async () => {
        expect(await updateHouseholdMember({ adopterId: 'p1', memberId: 'lm', name: 'X' })).toEqual({ ok: false, error: NOT_AUTHORIZED });
        expect(await removeHouseholdMember({ adopterId: 'p1', memberId: 'lm' })).toEqual({ ok: false, error: NOT_AUTHORIZED });
        expect(member('lm')!.name).toBe('Lucas Paez');
    });

    it("their own member that carries someone else's contact cannot be removed by them", async () => {
        const memberId = await strangerAddsMember();
        expect((await as(OWNER, () => addMemberContactEntry({ adopterId: 'p1', memberId, type: 'email', value: 'rosa@example.org' }))).ok).toBe(true);
        expect(await removeHouseholdMember({ adopterId: 'p1', memberId })).toEqual({ ok: false, error: NOT_AUTHORIZED });
        expect(member(memberId)!.contactEntries).toHaveLength(2);
        // …while editing its name stays theirs.
        expect(await updateHouseholdMember({ adopterId: 'p1', memberId, name: 'Rosa M.' })).toEqual({ ok: true });
    });

    it('the permission follows the member as stored at write time (a race cannot slip an edit through)', async () => {
        const memberId = await strangerAddsMember();
        // Between the load and the write, the member is credited to the owner.
        faults.beforeCas = () => {
            const list = members().map(m => (m.id === memberId ? { ...m, addedBy: OWNER } : m));
            sqlite.prepare(`UPDATE adopters SET household_members = ? WHERE id = 'p1'`).run(JSON.stringify(list));
        };
        expect(await updateHouseholdMember({ adopterId: 'p1', memberId, name: 'X' })).toEqual({ ok: false, error: NOT_AUTHORIZED });
        expect(member(memberId)!.name).toBe('Rosa Gomez');
    });

    it('the permission is decided on the stored member, not the input', async () => {
        // Same id as the owner's member, but the client claims it is theirs: still refused.
        expect(await updateHouseholdMember({ adopterId: 'p1', memberId: 'om', name: 'X', expected: { name: 'Marta Paez', relationship: 'partner' } }))
            .toEqual({ ok: false, error: NOT_AUTHORIZED });
    });
});

describe("a stranger and the member's contacts", () => {
    it("adds a contact to the owner's member ✓: credited, contribution, grant, owner told", async () => {
        const res = await addMemberContactEntry({ adopterId: 'p1', memberId: 'om', type: 'email', value: 'marta@example.org' });
        expect(res.ok).toBe(true);
        const entryId = (res as { entryId: string }).entryId;
        expect(member('om')!.contactEntries.find(e => e.id === entryId)).toMatchObject({ value: 'marta@example.org', addedBy: STRANGER });
        expect(history()).toEqual([expect.objectContaining({ changed_by: STRANGER, kind: 'contribution' })]);
        expect(grants(STRANGER)).toEqual([{ scope: 'entry', origin: 'contribution', entry_ref: hashEntryValue('email', 'marta@example.org') }]);
        const notices = contributionNotices();
        expect(notices.map(n => n.userId)).toEqual([OWNER]);
        expect((notices[0].template as { params: Record<string, string> }).params).toMatchObject({ what: 'contact', entryType: 'email' });
        expect(sqlite.prepare(`SELECT status FROM pii_access_requests WHERE adopter_id = 'p1' AND requester_email = ?`).all(STRANGER)).toEqual([{ status: 'pending' }]);
    });

    it("edits / removes the owner's contact ✗", async () => {
        expect(await updateMemberContactEntry({ adopterId: 'p1', memberId: 'om', entryId: 'oc', value: '+54 11 0000 0000' })).toEqual({ ok: false, error: NOT_AUTHORIZED });
        expect(await removeMemberContactEntry({ adopterId: 'p1', memberId: 'om', entryId: 'oc' })).toEqual({ ok: false, error: NOT_AUTHORIZED });
        expect(member('om')!.contactEntries).toEqual([expect.objectContaining({ id: 'oc', value: OWNER_PHONE })]);
    });

    it('edits their own contact ✓ (and still sees the new value) and removes it ✓', async () => {
        const res = await addMemberContactEntry({ adopterId: 'p1', memberId: 'om', type: 'phone', value: STRANGER_PHONE });
        const entryId = (res as { entryId: string }).entryId;
        expect(await updateMemberContactEntry({ adopterId: 'p1', memberId: 'om', entryId, value: '+54 11 5555 0909' })).toEqual({ ok: true });
        expect(grants(STRANGER).map(g => g.entry_ref)).toContain(hashEntryValue('phone', '+54 11 5555 0909'));
        expect(await removeMemberContactEntry({ adopterId: 'p1', memberId: 'om', entryId })).toEqual({ ok: true });
        expect(member('om')!.contactEntries.map(e => e.id)).toEqual(['oc']);
        expect(history().map(h => h.kind)).toEqual(['contribution', 'contribution', 'contribution']);
        expect((await resolveAdopterVisibility(STRANGER, { id: 'p1', addedBy: OWNER })).nothingMasked).toBe(false);
    });

    it("on their own member, a contact someone else added stays out of their reach", async () => {
        const memberId = await strangerAddsMember();
        const res = await as(OWNER, () => addMemberContactEntry({ adopterId: 'p1', memberId, type: 'email', value: 'rosa@example.org' }));
        const entryId = (res as { entryId: string }).entryId;
        expect(await updateMemberContactEntry({ adopterId: 'p1', memberId, entryId, value: 'x@example.org' })).toEqual({ ok: false, error: NOT_AUTHORIZED });
        expect(await removeMemberContactEntry({ adopterId: 'p1', memberId, entryId })).toEqual({ ok: false, error: NOT_AUTHORIZED });
    });
});

describe('privileged writers keep today\'s path', () => {
    it('an org-mate adds a member with a phone: history kind=edit, no grant, no contribution notice, no access request', async () => {
        const res = await as(MATE, () => addHouseholdMember({ adopterId: 'p1', name: 'Ana', relationship: 'sibling', contactEntries: [{ type: 'phone', value: '+54 11 7777 0000' }] }));
        expect(res.ok).toBe(true);
        expect(history()).toEqual([expect.objectContaining({ changed_by: MATE, kind: 'edit' })]);
        expect(grants(MATE)).toEqual([]);
        expect(contributionNotices()).toEqual([]);
        expect(sqlite.prepare(`SELECT id FROM pii_access_requests`).all()).toEqual([]);
    });

    it("the owner may edit and remove a stranger's member and contacts", async () => {
        const memberId = await strangerAddsMember();
        const entryId = member(memberId)!.contactEntries[0].id!;
        expect(await as(OWNER, () => updateMemberContactEntry({ adopterId: 'p1', memberId, entryId, value: '+54 11 1111 1111' }))).toEqual({ ok: true });
        expect(await as(OWNER, () => updateHouseholdMember({ adopterId: 'p1', memberId, name: 'R. Gomez' }))).toEqual({ ok: true });
        expect(await as(OWNER, () => removeHouseholdMember({ adopterId: 'p1', memberId }))).toEqual({ ok: true });
        expect(history().slice(1).map(h => h.kind)).toEqual(['edit', 'edit', 'edit']);
    });

    it('anonymous is still refused', async () => {
        expect(await as(null, () => addHouseholdMember({ adopterId: 'p1', name: 'X' }))).toEqual({ ok: false, error: 'Not authenticated' });
    });
});
