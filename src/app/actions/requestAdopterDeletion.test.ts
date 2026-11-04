/**
 * «Pedir eliminación» (household member card, D1): the owner of a profile other rescuers
 * contributed to may not delete it, only ask the admins. requestAdopterDeletion writes one
 * pending `deletion` data request, once. Real SQL. (The e2e household spec keeps the dialog.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { OWNER, session } = mocks;
const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));

vi.mock('./_db', () => ({
    getDb: async () => state.db, getUser: mocks.getUser,
    checkIsAdmin: (e: string) => e === mocks.ADMIN, checkIsAdminAsync: mocks.isAdmin,
}));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/auth', () => ({ auth: async () => (session.user ? { user: { email: session.user } } : null) }));
vi.mock('@/config/admins', () => ({ isAdminAsync: mocks.isAdmin, isModeratorOrAdminAsync: mocks.isAdmin }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async () => { /* admin notice is not under test */ }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
    withTrace: (_op: string, fn: () => unknown) => fn(),
}));

import { requestAdopterDeletion } from './adopters';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { all: (...a: unknown[]) => Row[]; run: (...a: unknown[]) => unknown } };
const requestsFor = (id: string) => sqlite.prepare(`SELECT status, request_type FROM data_requests WHERE adopter_id = ?`).all(id);

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES (?, ?, '5', ?, 1000, 1000)`).run('dos', 'Pedir Dos', OWNER);
});

describe('requestAdopterDeletion', () => {
    it('the owner asks: one pending deletion request', async () => {
        session.user = OWNER;
        expect(await requestAdopterDeletion('dos')).toMatchObject({ success: true });
        expect(requestsFor('dos')).toEqual([{ status: 'pending', request_type: 'deletion' }]);
    });

    it('asking twice does not pile up requests', async () => {
        session.user = OWNER;
        await requestAdopterDeletion('dos');
        expect(await requestAdopterDeletion('dos')).toEqual({ success: true, alreadyRequested: true });
        expect(requestsFor('dos')).toHaveLength(1);
    });

    it('someone who is not the owner is refused and nothing is written', async () => {
        session.user = 'someone-else@example.com';
        await expect(requestAdopterDeletion('dos')).rejects.toThrow();
        expect(requestsFor('dos')).toHaveLength(0);
    });
});
