/**
 * saveAdopter — field-level collision protection (src/domain/fieldCollab.ts).
 * Real SQL on the real schema. A teammate's save is simulated either before
 * the editor's save, or injected between saveAdopter's read and its write
 * (the `interleave` hook runs inside the authorization check, which sits
 * exactly there).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import { session, getUser, isAdmin, isOwnerOrOrgMate, OWNER, MATE, STRANGER } from '@/test-utils/actionMocks';
import * as mocks from '@/test-utils/actionMocks';

const { state, tokenize, audit } = vi.hoisted(() => ({
    state: { db: null as unknown, interleave: null as null | (() => void) },
    tokenize: { calls: [] as string[] },
    audit: { calls: [] as unknown[] },
}));
vi.mock('./_db', () => ({ getDb: async () => state.db, getUser }));
vi.mock('@/config/admins', () => ({ isAdminAsync: isAdmin, isModeratorOrAdminAsync: isAdmin }));
vi.mock('@/lib/orgMembership', () => ({
    isOrgMate: async (a: string, b: string) => {
        const hook = state.interleave;
        state.interleave = null;
        hook?.();
        return mocks.isOrgMate(a, b);
    },
    isOwnerOrOrgMate,
}));
vi.mock('@/lib/adopterTokenize', () => ({ tokenizeAdopter: vi.fn(async (id: string) => { tokenize.calls.push(id); }) }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/requestContext', () => ({ getRequestContext: () => ({ env: {} }) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn((e: unknown) => { audit.calls.push(e); }) }));

import { saveAdopter } from './adopters';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };

const ID = 'adopter-collab-1';
const LOADED = { name: 'Carla Gómez', status: '5', familyMembers: 'Hijo' };

const row = () => sqlite.prepare('SELECT * FROM adopters WHERE id = ?').get(ID)!;
const historyRows = () => sqlite.prepare('SELECT * FROM adopter_history WHERE adopter_id = ? ORDER BY rowid').all(ID);
/** A teammate's save that went through saveAdopter earlier (so history names them). */
async function mateSaves(fields: Partial<typeof LOADED>) {
    const before = session.user;
    session.user = MATE;
    const res = await saveAdopter({ id: ID, ...fields }, { loaded: LOADED });
    session.user = before;
    expect(res.success).toBe(true);
}

describe('saveAdopter — per-field collisions', () => {
    beforeEach(() => {
        const m = migratedDb();
        state.db = m.db;
        state.interleave = null;
        tokenize.calls = [];
        audit.calls = [];
        sqlite = m.sqlite as unknown as typeof sqlite;
        session.user = OWNER;
        sqlite.prepare(`INSERT INTO adopters (id, name, status, family_members, added_by, created_at, updated_at)
            VALUES (?, 'Carla Gómez', '5', 'Hijo', ?, 1000, 1000)`).run(ID, OWNER);
        sqlite.prepare(`INSERT INTO user (id, name, email) VALUES ('u-mate', 'Marta Ruiz', ?)`).run(MATE);
    });

    it('a stale tab never reverts a field it did not touch; the other field is reported back', async () => {
        await mateSaves({ familyMembers: 'Hijo y un perro' });
        // The stale tab still shows family = 'Hijo' and sends everything it has.
        const res = await saveAdopter({ id: ID, name: 'Carla G.', familyMembers: 'Hijo', status: '5' }, { loaded: LOADED });
        expect(res.success).toBe(true);
        if (!res.success) return;
        expect(row().name).toBe('Carla G.');
        expect(row().family_members).toBe('Hijo y un perro');
        expect(res.conflicts).toEqual([]);
        expect(res.updatedByOthers).toEqual([{ field: 'familyMembers', by: 'Marta Ruiz', value: 'Hijo y un perro' }]);
    });

    it('different fields edited by two people both land', async () => {
        await mateSaves({ name: 'Carla Gómez Paz' });
        const res = await saveAdopter({ id: ID, familyMembers: 'Hijo y abuela' }, { loaded: LOADED });
        expect(res.success).toBe(true);
        expect(row().name).toBe('Carla Gómez Paz');
        expect(row().family_members).toBe('Hijo y abuela');
    });

    it('the same field: refused per field, names who changed it, nothing of theirs overwritten, no history row', async () => {
        await mateSaves({ name: 'Carla Pérez' });
        const historyBefore = historyRows().length;
        const auditBefore = audit.calls.length;
        const res = await saveAdopter({ id: ID, name: 'Carla López' }, { loaded: LOADED });
        expect(res.success).toBe(true);
        if (!res.success) return;
        expect(res.conflicts).toEqual([{ field: 'name', by: 'Marta Ruiz', value: 'Carla Pérez' }]);
        expect(res.saved).toEqual([]);
        expect(row().name).toBe('Carla Pérez');
        expect(historyRows().length).toBe(historyBefore);
        expect(audit.calls.length).toBe(auditBefore);
    });

    it('«Guardar la mía igual»: comparing against the value the editor has now seen writes it', async () => {
        await mateSaves({ name: 'Carla Pérez' });
        const res = await saveAdopter({ id: ID, name: 'Carla López' }, { loaded: { ...LOADED, name: 'Carla Pérez' } });
        expect(res.success && res.conflicts).toEqual([]);
        expect(row().name).toBe('Carla López');
    });

    it('both typed the same value: counts as saved, no second history row', async () => {
        await mateSaves({ name: 'Carla López' });
        const before = historyRows().length;
        const res = await saveAdopter({ id: ID, name: 'Carla López' }, { loaded: LOADED });
        expect(res.success && res.conflicts).toEqual([]);
        expect(res.success && res.saved).toEqual(['name']);
        expect(historyRows().length).toBe(before);
    });

    it('a teammate saving the same field between the read and the write: the write is refused, theirs stays', async () => {
        state.interleave = () => sqlite.prepare(`UPDATE adopters SET name = 'Carla Ruiz' WHERE id = ?`).run(ID);
        const res = await saveAdopter({ id: ID, name: 'Carla López' }, { loaded: LOADED });
        expect(res.success).toBe(true);
        if (!res.success) return;
        expect(row().name).toBe('Carla Ruiz');
        // Written outside saveAdopter: no history names them.
        expect(res.conflicts).toEqual([{ field: 'name', by: '', value: 'Carla Ruiz' }]);
        expect(historyRows().length).toBe(0);
    });

    it('a teammate saving a DIFFERENT field between the read and the write: both land', async () => {
        state.interleave = () => sqlite.prepare(`UPDATE adopters SET family_members = 'Hijo y gato', updated_at = 2000 WHERE id = ?`).run(ID);
        const res = await saveAdopter({ id: ID, name: 'Carla López' }, { loaded: LOADED });
        expect(res.success && res.conflicts).toEqual([]);
        expect(row().name).toBe('Carla López');
        expect(row().family_members).toBe('Hijo y gato');
    });

    it('one history row and one audit row per successful save, listing only what was written', async () => {
        const res = await saveAdopter({ id: ID, name: 'Carla López', familyMembers: 'Hijo', status: '5' }, { loaded: LOADED });
        expect(res.success).toBe(true);
        const h = historyRows();
        expect(h.length).toBe(1);
        expect(Object.keys(JSON.parse(h[0].changes as string))).toEqual(['name']);
        expect(audit.calls.length).toBe(1);
    });

    it('re-tokenizes only when a name field changed', async () => {
        await saveAdopter({ id: ID, status: '4' }, { loaded: LOADED });
        expect(tokenize.calls).toEqual([]);
        await saveAdopter({ id: ID, familyMembers: 'Hijo Juan' }, { loaded: { ...LOADED, status: '4' } });
        expect(tokenize.calls).toEqual([ID]);
    });

    it('callers without a baseline keep the old behaviour (write what differs)', async () => {
        const res = await saveAdopter({ id: ID, name: 'Carla Gómez', familyMembers: 'Otra' });
        expect(res.success).toBe(true);
        expect(row().family_members).toBe('Otra');
        expect(historyRows().length).toBe(1);
    });

    it('losing the race twice: a localized-busy result with an errorId, nothing written', async () => {
        // Every write attempt finds the name changed underneath it.
        let n = 0;
        const real = state.db as { update: (...a: unknown[]) => unknown };
        state.db = new Proxy(real, {
            get(target, prop, recv) {
                if (prop === 'update') return (...a: unknown[]) => {
                    sqlite.prepare(`UPDATE adopters SET name = ? WHERE id = ?`).run(`Carla ${++n}`, ID);
                    return (target.update as (...x: unknown[]) => unknown).apply(target, a);
                };
                return Reflect.get(target, prop, recv);
            },
        });
        const res = await saveAdopter({ id: ID, name: 'Carla López' });
        expect(res).toMatchObject({ success: false, error: 'busy' });
        expect(!res.success && res.errorId).toMatch(/\w{6,}/);
        expect(row().name).toBe('Carla 2');
        expect(historyRows().length).toBe(0);
    });

    it('authorization is unchanged: a stranger is refused', async () => {
        session.user = STRANGER;
        await expect(saveAdopter({ id: ID, name: 'X' }, { loaded: LOADED })).rejects.toThrow(/Error ID/);
        expect(row().name).toBe('Carla Gómez');
    });

    it('an id with no name and no contact never creates an empty profile', async () => {
        await expect(saveAdopter({ id: 'no-such-adopter', familyMembers: 'x' })).rejects.toThrow(/Error ID/);
        expect(sqlite.prepare('SELECT COUNT(*) AS n FROM adopters').get()!.n).toBe(1);
    });

    it('a malformed baseline is rejected', async () => {
        await expect(saveAdopter({ id: ID, name: 'X' }, { loaded: { name: 5 } } as never)).rejects.toThrow(/Invalid adopter data/);
        await expect(saveAdopter({ id: ID, name: 'X' }, { loaded: { addedBy: 'x' } } as never)).rejects.toThrow(/Invalid adopter data/);
    });
});
