/**
 * transferAdopterOwnership — who hears (Jon 2026-11-08): ONLY the new owner,
 * never the old one; not filtered by «Avisame de cambios hechos por:» (a
 * transfer always reaches the new owner), but your own change never notifies
 * you. Real SQL (every drizzle/*.sql); the notices are kept in memory.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';
import { chooseProfileChangesFrom } from '@/test-utils/profileChangesFrom';

const { ADMIN, OWNER, MATE } = mocks;
const { state, notify } = vi.hoisted(() => ({
    state: { db: null as unknown },
    notify: { create: [] as Array<Record<string, unknown>> },
}));

vi.mock('./_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser, checkIsAdmin: (e: string) => e === mocks.ADMIN, checkIsAdminAsync: async (e: string) => e === mocks.ADMIN }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/auth', () => ({ auth: async () => ({ user: { email: mocks.ADMIN } }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/requestContext', () => ({ getRequestContext: () => ({ env: {} }) }));
vi.mock('@/lib/orgMembership', async (orig) => ({ ...(await orig()), isOrgMate: mocks.isOrgMate, getOrgMemberEmailsFor: mocks.getOrgMemberEmailsFor }));
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async (_n: string, task: () => Promise<unknown>) => { await task(); }) }));
vi.mock('./notifications', () => ({
    createNotification: vi.fn(async (d: Record<string, unknown>) => { notify.create.push(d); return 'n'; }),
    resolveDisplayNames: vi.fn(async (emails: string[]) => new Map(emails.map(e => [e.toLowerCase(), e.split('@')[0]]))),
}));
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
    withTrace: (_op: string, fn: () => unknown) => fn(),
}));

import { transferAdopterOwnership } from './admin';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown } };

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    notify.create.length = 0;
    sqlite.prepare(`INSERT INTO user (id, email) VALUES ('u-mate', ?), ('u-admin', ?)`).run(MATE, ADMIN);
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('pedro', 'Pedro Paez', '5', ?, 1000, 1000)`).run(OWNER);
});

describe('transferAdopterOwnership — notices', () => {
    it('tells only the new owner (role «to»), never the old owner', async () => {
        expect(await transferAdopterOwnership('pedro', MATE)).toMatchObject({ ok: true, from: OWNER, to: MATE });
        expect(notify.create.map(n => n.userId)).toEqual([MATE]);
        expect(notify.create[0]).toMatchObject({ type: 'ownership_transferred', url: '/adopter/pedro', template: { params: expect.objectContaining({ role: 'to' }) } });
    });

    it('is not filtered by «Avisame de cambios hechos por:» (a teammate of the old owner still hears it)', async () => {
        chooseProfileChangesFrom(sqlite, MATE, 'outside');
        await transferAdopterOwnership('pedro', MATE);
        expect(notify.create.map(n => n.userId)).toEqual([MATE]);
    });

    it('an admin transferring to themselves is not told of their own change', async () => {
        expect(await transferAdopterOwnership('pedro', ADMIN)).toMatchObject({ ok: true, to: ADMIN });
        expect(notify.create).toEqual([]);
    });
});
