/**
 * Task 8 fix round 1 (A2, A6): a profile deleted for good leaves its ordinary
 * households — through the owner's delete (deleteOwnAdopter) and the admin's
 * (admin.ts deleteAdopter) alike — and only once its row is gone. Real SQL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { OWNER, ADMIN, session } = mocks;
const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));

vi.mock('./_db', () => ({
    getDb: async () => state.db, getUser: mocks.getUser,
    checkIsAdmin: (e: string) => e === mocks.ADMIN, checkIsAdminAsync: mocks.isAdmin,
}));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/auth', () => ({ auth: async () => (session.user ? { user: { email: session.user } } : null) }));
vi.mock('@/config/admins', () => ({ isAdminAsync: mocks.isAdmin, isModeratorOrAdminAsync: mocks.isAdmin }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async (_n: string, task: () => Promise<unknown>) => { await task(); }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
    withTrace: (_op: string, fn: () => unknown) => fn(),
}));

import { deleteOwnAdopter } from './adopters';
import { deleteAdopter } from './admin';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] }; exec: (s: string) => void };
const membershipsOf = (id: string) => sqlite.prepare('SELECT household_id FROM household_memberships WHERE adopter_id = ? ORDER BY household_id').all(id).map(r => r.household_id);

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    const insert = sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES (?, ?, '5', ?, 1000, 1000)`);
    insert.run('pedro', 'Pedro Paez', OWNER);
    insert.run('lucas', 'Lucas Paez', OWNER);
    insert.run('ana', 'Ana Giver', OWNER);
    sqlite.exec(`INSERT INTO households (id, created_by, created_at) VALUES ('hh-pedro', NULL, 1), ('gift1', NULL, 1)`);
    sqlite.exec(`INSERT INTO household_memberships (id, household_id, adopter_id, relationship, relative_to_adopter_id, gift_recipient, added_by, added_at) VALUES
        ('m1', 'hh-pedro', 'pedro', 'unknown', NULL, 0, NULL, 1),
        ('m2', 'hh-pedro', 'lucas', 'child', 'pedro', 0, '${OWNER}', 2),
        ('g1', 'gift1', 'lucas', 'unknown', 'ana', 1, '${OWNER}', 3),
        ('g2', 'gift1', 'ana', 'unknown', NULL, 0, NULL, 4)`);
});

describe('deleting a profile for good takes it out of its ordinary households (Task 8 fix A2/A6)', () => {
    it("the owner's delete (deleteOwnAdopter): row gone, ordinary membership gone, the gift row left for «Crear perfil»", async () => {
        session.user = OWNER;
        expect(await deleteOwnAdopter('lucas')).toEqual({ success: true });
        expect(sqlite.prepare(`SELECT id FROM adopters WHERE id = 'lucas'`).get()).toBeUndefined();
        expect(membershipsOf('lucas')).toEqual(['gift1']);
        expect(membershipsOf('pedro')).toEqual(['hh-pedro']);
    });

    it("the admin's delete (admin.ts deleteAdopter) does the same", async () => {
        session.user = ADMIN;
        const res = await deleteAdopter('lucas');
        expect(res).toMatchObject({ success: true });
        expect(sqlite.prepare(`SELECT id FROM adopters WHERE id = 'lucas'`).get()).toBeUndefined();
        expect(membershipsOf('lucas')).toEqual(['gift1']);
    });

    it('a refused delete leaves the memberships (they go only once the row is gone)', async () => {
        session.user = 'someone-else@example.com';
        await expect(deleteOwnAdopter('lucas')).rejects.toThrow();
        expect(membershipsOf('lucas')).toEqual(['gift1', 'hh-pedro']);
    });
});
