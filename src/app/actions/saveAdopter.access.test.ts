/**
 * saveAdopter: a session is required, the actor comes from it, and only the
 * client-editable columns are written. Real SQL on the real schema.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import { session, getUser, isAdmin, isOrgMate, isOwnerOrOrgMate, OWNER, MATE, STRANGER, ADMIN } from '@/test-utils/actionMocks';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));
vi.mock('./_db', () => ({ getDb: async () => state.db, getUser }));
vi.mock('@/config/admins', () => ({ isAdminAsync: isAdmin, isModeratorOrAdminAsync: isAdmin }));
vi.mock('@/lib/orgMembership', () => ({ isOrgMate, isOwnerOrOrgMate }));
vi.mock('@/lib/adopterTokenize', () => ({ tokenizeAdopter: vi.fn(async () => undefined) }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/requestContext', () => ({ getRequestContext: () => ({ env: {} }) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

import { saveAdopter } from './adopters';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown } };

function seedOwned(id: string, addedBy: string) {
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at, deleted_at, is_demo, token_hash)
        VALUES (?, 'Carla Gómez', '5', ?, 1000, 1000, NULL, 0, 'hash-original')`).run(id, addedBy);
}
const row = (id: string) => sqlite.prepare('SELECT * FROM adopters WHERE id = ?').get(id)!;

describe('saveAdopter — session and column whitelist', () => {
    beforeEach(() => {
        const m = migratedDb();
        state.db = m.db;
        sqlite = m.sqlite as unknown as typeof sqlite;
        session.user = OWNER;
    });

    it('anonymous: refused with an errorId, nothing written', async () => {
        session.user = null;
        await expect(saveAdopter({ name: 'Anon Create' } as never)).rejects.toThrow(/Authentication required \(Error ID: \w+\)/);
        expect(sqlite.prepare("SELECT COUNT(*) AS n FROM adopters WHERE name = 'Anon Create'").get()!.n).toBe(0);
    });

    it('create: addedBy is the session; id, createdAt, deletedAt, isDemo, tokenHash from the payload are ignored', async () => {
        const res = await saveAdopter({
            id: 'client-chosen-id', name: 'Nueva Persona', status: '5', familyMembers: 'Hijo',
            addedBy: STRANGER, createdAt: new Date(0), deletedAt: new Date(), isDemo: 1, tokenHash: 'forged',
        } as never);
        expect(res.success).toBe(true);
        if (!res.success) throw new Error('save failed');
        expect(res.id).not.toBe('client-chosen-id');
        const r = row(res.id as string);
        expect(r.added_by).toBe(OWNER);
        expect(r.deleted_at).toBeNull();
        expect(r.is_demo === 0 || r.is_demo === null).toBe(true);
        expect(r.token_hash).not.toBe('forged');
        expect(r.family_members).toBe('Hijo');
        expect(Number(r.created_at)).toBeGreaterThan(1_000_000);
    });

    it('update by the owner: name / status / family change; addedBy, createdAt, deletedAt, isDemo, tokenHash do not', async () => {
        seedOwned('a1', OWNER);
        await saveAdopter({
            id: 'a1', name: 'Carla Renombrada', status: '4', familyMembers: 'Pareja',
            addedBy: STRANGER, createdAt: new Date(5), deletedAt: new Date(), isDemo: 1, tokenHash: 'forged', country: 'XX',
        } as never);
        const r = row('a1');
        expect([r.name, r.status, r.family_members]).toEqual(['Carla Renombrada', '4', 'Pareja']);
        expect([r.added_by, r.created_at, r.deleted_at, r.is_demo, r.token_hash]).toEqual([OWNER, 1000, null, 0, 'hash-original']);
        expect(r.country).not.toBe('XX');
    });

    it('update by a teammate or an admin: allowed', async () => {
        seedOwned('a2', OWNER);
        session.user = MATE;
        await saveAdopter({ id: 'a2', name: 'Por Compañera' } as never);
        expect(row('a2').name).toBe('Por Compañera');
        session.user = ADMIN;
        await saveAdopter({ id: 'a2', name: 'Por Admin' } as never);
        expect(row('a2').name).toBe('Por Admin');
    });

    it('update by a stranger: refused', async () => {
        seedOwned('a3', OWNER);
        session.user = STRANGER;
        await expect(saveAdopter({ id: 'a3', name: 'Hackeado' } as never)).rejects.toThrow(/Error ID/);
        expect(row('a3').name).toBe('Carla Gómez');
    });

    it('a record whose addedBy is "Unknown" is not editable by an anonymous caller', async () => {
        seedOwned('a4', 'Unknown');
        session.user = null;
        await expect(saveAdopter({ id: 'a4', name: 'Hackeado' } as never)).rejects.toThrow(/Authentication required/);
        expect(row('a4').name).toBe('Carla Gómez');
    });
});
