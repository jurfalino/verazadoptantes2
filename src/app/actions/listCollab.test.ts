/**
 * Contact entries and household members — concurrent edits never lose one,
 * and an edit/removal of an item a teammate changed or deleted meanwhile is
 * refused with who did it (src/lib/adopterListCas.ts). Real SQL on the real
 * schema. A competing write is injected between an action's read of the list
 * and its write through `state.race` (runs just before the next UPDATE).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import { session, getUser, isAdmin, isOrgMate, isOwnerOrOrgMate, OWNER, MATE } from '@/test-utils/actionMocks';

const { state, tokenize } = vi.hoisted(() => ({
    state: { db: null as unknown, race: null as null | (() => void), raceEvery: false },
    tokenize: { calls: 0 },
}));
vi.mock('./_db', () => ({ getDb: async () => state.db, getUser }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/config/admins', () => ({ isAdminAsync: isAdmin, isModeratorOrAdminAsync: isAdmin }));
vi.mock('@/lib/orgMembership', () => ({ isOrgMate, isOwnerOrOrgMate }));
vi.mock('@/lib/adopterTokenize', () => ({ tokenizeAdopter: vi.fn(async () => { tokenize.calls++; }) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async () => undefined) }));
vi.mock('@/lib/piiAccessRequest', () => ({ fileAccessRequestFor: vi.fn(async () => ({ status: 'has_access' })) }));
vi.mock('./notifications', () => ({ createNotification: vi.fn(), resolveDisplayName: vi.fn(async () => '') }));
vi.mock('./piiAccess', () => ({ getAdopterApprovers: vi.fn(async () => []) }));

import { addContactEntry } from './addContactEntry';
import { updateContactEntry } from './updateContactEntry';
import { removeContactEntry } from './removeContactEntry';
import { updateHouseholdMember, removeHouseholdMember, addMemberContactEntry, updateMemberContactEntry, removeMemberContactEntry } from './householdMembers';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };

const ID = 'adopter-list-1';
const ENTRIES = [
    { id: 'e-phone', type: 'phone', value: '1155551111', addedBy: OWNER },
    { id: 'e-mail', type: 'email', value: 'carla@example.com', addedBy: OWNER },
];
const MEMBERS = [
    { id: 'm-1', name: 'Juan', relationship: 'child', contactEntries: [{ id: 'mc-1', type: 'phone', value: '1166662222' }], addedBy: OWNER },
    { id: 'm-2', name: 'Lucía', relationship: 'child', contactEntries: [], addedBy: OWNER },
];

const entries = () => JSON.parse((sqlite.prepare('SELECT contact_entries FROM adopters WHERE id = ?').get(ID)!.contact_entries as string) || '[]') as Array<{ id: string; value: string }>;
const members = () => JSON.parse(sqlite.prepare('SELECT household_members FROM adopters WHERE id = ?').get(ID)!.household_members as string) as Array<{ id: string; name: string; contactEntries: Array<{ id: string; value: string }> }>;
const valueOf = (id: string) => entries().find(e => e.id === id)?.value;
const historyCount = () => sqlite.prepare('SELECT COUNT(*) AS n FROM adopter_history WHERE adopter_id = ?').get(ID)!.n as number;

/** A teammate's write that lands between the action's read and its UPDATE. */
function raceWith(fn: () => void, every = false) {
    state.race = fn;
    state.raceEvery = every;
}
const setEntries = (list: unknown[]) => sqlite.prepare('UPDATE adopters SET contact_entries = ? WHERE id = ?').run(JSON.stringify(list), ID);
const setMembers = (list: unknown[]) => sqlite.prepare('UPDATE adopters SET household_members = ? WHERE id = ?').run(JSON.stringify(list), ID);

async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
    const before = session.user;
    session.user = user;
    try { return await fn(); } finally { session.user = before; }
}

beforeEach(() => {
    const m = migratedDb();
    sqlite = m.sqlite as unknown as typeof sqlite;
    state.race = null;
    state.raceEvery = false;
    tokenize.calls = 0;
    const real = m.db as { update: (...a: unknown[]) => unknown };
    state.db = new Proxy(real, {
        get(target, prop, recv) {
            if (prop === 'update') return (...a: unknown[]) => {
                const hook = state.race;
                if (hook && !state.raceEvery) state.race = null;
                hook?.();
                return (target.update as (...x: unknown[]) => unknown).apply(target, a);
            };
            return Reflect.get(target, prop, recv);
        },
    });
    session.user = OWNER;
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, contact_entries, contact_info, household_members, created_at, updated_at)
        VALUES (?, 'Carla Gómez', '5', ?, ?, '1155551111\ncarla@example.com', ?, 1000, 1000)`).run(ID, OWNER, JSON.stringify(ENTRIES), JSON.stringify(MEMBERS));
    sqlite.prepare(`INSERT INTO user (id, name, email) VALUES ('u-mate', 'Marta Ruiz', ?)`).run(MATE);
});

describe('contact entries — concurrent edits', () => {
    it('editing one entry while a teammate edits another: both land', async () => {
        raceWith(() => setEntries([ENTRIES[0], { ...ENTRIES[1], value: 'carla.g@example.com' }]));
        const res = await updateContactEntry({ adopterId: ID, entryId: 'e-phone', value: '1155559999', expectedValue: '1155551111' });
        expect(res.ok).toBe(true);
        expect(valueOf('e-phone')).toBe('1155559999');
        expect(valueOf('e-mail')).toBe('carla.g@example.com');
    });

    it('two adds at the same moment: both land', async () => {
        raceWith(() => setEntries([...ENTRIES, { id: 'e-new-mate', type: 'phone', value: '1177773333', addedBy: MATE }]));
        const res = await addContactEntry({ adopterId: ID, type: 'email', value: 'otra@example.com' });
        expect(res.ok).toBe(true);
        const values = entries().map(e => e.value);
        expect(values).toContain('1177773333');
        expect(values).toContain('otra@example.com');
        // The derived blob follows the list.
        const blob = sqlite.prepare('SELECT contact_info FROM adopters WHERE id = ?').get(ID)!.contact_info as string;
        expect(blob).toContain('1177773333');
        expect(blob).toContain('otra@example.com');
    });

    it('removing one entry while a teammate edits another: the edit survives', async () => {
        raceWith(() => setEntries([ENTRIES[0], { ...ENTRIES[1], value: 'carla.g@example.com' }]));
        const res = await removeContactEntry({ adopterId: ID, entryId: 'e-phone', expectedValue: '1155551111' });
        expect(res.ok).toBe(true);
        expect(entries().map(e => e.id)).toEqual(['e-mail']);
        expect(valueOf('e-mail')).toBe('carla.g@example.com');
    });

    it('editing an entry a teammate changed: refused with their name, nothing overwritten, no history row', async () => {
        await as(MATE, () => updateContactEntry({ adopterId: ID, entryId: 'e-phone', value: '1155552222', expectedValue: '1155551111' }));
        const before = historyCount();
        const tokBefore = tokenize.calls;
        const res = await updateContactEntry({ adopterId: ID, entryId: 'e-phone', value: '1155553333', expectedValue: '1155551111' });
        expect(res).toEqual({ ok: false, error: 'conflict', conflict: { kind: 'changed', by: 'Marta Ruiz' } });
        expect(valueOf('e-phone')).toBe('1155552222');
        expect(historyCount()).toBe(before);
        expect(tokenize.calls).toBe(tokBefore);
    });

    it('both typed the same correction: counts as saved', async () => {
        await as(MATE, () => updateContactEntry({ adopterId: ID, entryId: 'e-phone', value: '1155552222', expectedValue: '1155551111' }));
        const res = await updateContactEntry({ adopterId: ID, entryId: 'e-phone', value: '1155552222', expectedValue: '1155551111' });
        expect(res.ok).toBe(true);
    });

    it('editing or removing an entry a teammate deleted: «ya no existe», with their name', async () => {
        await as(MATE, () => removeContactEntry({ adopterId: ID, entryId: 'e-mail', expectedValue: 'carla@example.com' }));
        const upd = await updateContactEntry({ adopterId: ID, entryId: 'e-mail', value: 'x@example.com', expectedValue: 'carla@example.com' });
        expect(upd).toEqual({ ok: false, error: 'conflict', conflict: { kind: 'deleted', by: 'Marta Ruiz' } });
        const rem = await removeContactEntry({ adopterId: ID, entryId: 'e-mail', expectedValue: 'carla@example.com' });
        expect(rem).toEqual({ ok: false, error: 'conflict', conflict: { kind: 'deleted', by: 'Marta Ruiz' } });
    });

    it('removing an entry a teammate changed is refused (never delete what the person has not seen)', async () => {
        await as(MATE, () => updateContactEntry({ adopterId: ID, entryId: 'e-phone', value: '1155552222', expectedValue: '1155551111' }));
        const res = await removeContactEntry({ adopterId: ID, entryId: 'e-phone', expectedValue: '1155551111' });
        expect(res).toMatchObject({ ok: false, error: 'conflict', conflict: { kind: 'changed' } });
        expect(valueOf('e-phone')).toBe('1155552222');
    });

    it('a refusal never carries the value', async () => {
        await as(MATE, () => updateContactEntry({ adopterId: ID, entryId: 'e-phone', value: '1155552222', expectedValue: '1155551111' }));
        const res = await updateContactEntry({ adopterId: ID, entryId: 'e-phone', value: '1155553333', expectedValue: '1155551111' });
        expect(JSON.stringify(res)).not.toContain('1155552222');
    });

    it('callers that send no expected value keep the old behaviour', async () => {
        setEntries([{ ...ENTRIES[0], value: '1155552222' }, ENTRIES[1]]);
        const res = await updateContactEntry({ adopterId: ID, entryId: 'e-phone', value: '1155553333' });
        expect(res.ok).toBe(true);
        expect(valueOf('e-phone')).toBe('1155553333');
    });

    it('one history row and one re-tokenize per successful edit', async () => {
        await updateContactEntry({ adopterId: ID, entryId: 'e-phone', value: '1155559999', expectedValue: '1155551111' });
        expect(historyCount()).toBe(1);
        expect(tokenize.calls).toBe(1);
    });

    it('losing every race: a busy result with an errorId, nothing written', async () => {
        let n = 0;
        raceWith(() => setEntries([ENTRIES[0], { ...ENTRIES[1], value: `c${++n}@example.com` }]), true);
        const res = await updateContactEntry({ adopterId: ID, entryId: 'e-phone', value: '1155559999', expectedValue: '1155551111' });
        expect(res).toMatchObject({ ok: false, error: 'busy' });
        expect((res as { errorId?: string }).errorId).toMatch(/\w{6,}/);
        expect(valueOf('e-phone')).toBe('1155551111');
        expect(historyCount()).toBe(0);
    });

    it('authorization is unchanged: a stranger cannot edit', async () => {
        const res = await as('stranger@example.com', () => updateContactEntry({ adopterId: ID, entryId: 'e-phone', value: '1', expectedValue: '1155551111' }));
        expect(res.ok).toBe(false);
        expect(valueOf('e-phone')).toBe('1155551111');
    });
});

describe('household members — concurrent edits', () => {
    it('editing one person while a teammate edits another: both land', async () => {
        raceWith(() => setMembers([MEMBERS[0], { ...MEMBERS[1], name: 'Lucía Gómez' }]));
        const res = await updateHouseholdMember({ adopterId: ID, memberId: 'm-1', name: 'Juan Pablo', relationship: 'child', expected: { name: 'Juan', relationship: 'child' } });
        expect(res.ok).toBe(true);
        expect(members().map(m => m.name)).toEqual(['Juan Pablo', 'Lucía Gómez']);
    });

    it('a person a teammate renamed: refused with their name', async () => {
        await as(MATE, () => updateHouseholdMember({ adopterId: ID, memberId: 'm-1', name: 'Juan Carlos', relationship: 'child', expected: { name: 'Juan', relationship: 'child' } }));
        const res = await updateHouseholdMember({ adopterId: ID, memberId: 'm-1', name: 'Juanito', relationship: 'child', expected: { name: 'Juan', relationship: 'child' } });
        expect(res).toEqual({ ok: false, error: 'conflict', conflict: { kind: 'changed', by: 'Marta Ruiz' } });
        expect(members()[0].name).toBe('Juan Carlos');
    });

    it('a person a teammate removed: «ya no existe»', async () => {
        await as(MATE, () => removeHouseholdMember({ adopterId: ID, memberId: 'm-2', expected: { name: 'Lucía', relationship: 'child' } }));
        const res = await updateHouseholdMember({ adopterId: ID, memberId: 'm-2', name: 'Lu', relationship: 'child', expected: { name: 'Lucía', relationship: 'child' } });
        expect(res).toEqual({ ok: false, error: 'conflict', conflict: { kind: 'deleted', by: 'Marta Ruiz' } });
    });

    it('a contact edit racing a contact add on another person: both land', async () => {
        raceWith(() => setMembers([MEMBERS[0], { ...MEMBERS[1], contactEntries: [{ id: 'mc-new', type: 'phone', value: '1188884444' }] }]));
        const res = await updateMemberContactEntry({ adopterId: ID, memberId: 'm-1', entryId: 'mc-1', value: '1166660000', expectedValue: '1166662222' });
        expect(res.ok).toBe(true);
        expect(members()[0].contactEntries[0].value).toBe('1166660000');
        expect(members()[1].contactEntries.map(e => e.value)).toEqual(['1188884444']);
    });

    it('a contact a teammate changed or removed: refused', async () => {
        await as(MATE, () => updateMemberContactEntry({ adopterId: ID, memberId: 'm-1', entryId: 'mc-1', value: '1166663333', expectedValue: '1166662222' }));
        const upd = await updateMemberContactEntry({ adopterId: ID, memberId: 'm-1', entryId: 'mc-1', value: '1166664444', expectedValue: '1166662222' });
        expect(upd).toEqual({ ok: false, error: 'conflict', conflict: { kind: 'changed', by: 'Marta Ruiz' } });
        await as(MATE, () => removeMemberContactEntry({ adopterId: ID, memberId: 'm-1', entryId: 'mc-1', expectedValue: '1166663333' }));
        const rem = await removeMemberContactEntry({ adopterId: ID, memberId: 'm-1', entryId: 'mc-1', expectedValue: '1166663333' });
        expect(rem).toEqual({ ok: false, error: 'conflict', conflict: { kind: 'deleted', by: 'Marta Ruiz' } });
    });

    it('adds never lose a concurrent change', async () => {
        raceWith(() => setMembers([{ ...MEMBERS[0], name: 'Juan C.' }, MEMBERS[1]]));
        const res = await addMemberContactEntry({ adopterId: ID, memberId: 'm-2', type: 'email', value: 'lu@example.com' });
        expect(res.ok).toBe(true);
        expect(members()[0].name).toBe('Juan C.');
        expect(members()[1].contactEntries.map(e => e.value)).toEqual(['lu@example.com']);
    });
});
