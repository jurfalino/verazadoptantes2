/**
 * Households as profiles, final fix D3 — «Purgar todo» leaves no household
 * rows naming adopters that no longer exist. Real SQL (every drizzle/*.sql).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import * as mocks from '@/test-utils/actionMocks';

const { ADMIN, OWNER } = mocks;
const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));

vi.mock('./_db', () => ({ getDb: async () => state.db, getUser: mocks.getUser, checkIsAdmin: (e: string) => e === mocks.ADMIN, checkIsAdminAsync: async (e: string) => e === mocks.ADMIN }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/auth', () => ({ auth: async () => ({ user: { email: mocks.ADMIN } }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/requestContext', () => ({ getRequestContext: () => ({ env: {} }) }));
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
    withTrace: (_op: string, fn: () => unknown) => fn(),
}));

import { purgeAllData } from './admin';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { get: (...a: unknown[]) => Row | undefined; run: (...a: unknown[]) => unknown } };
const count = (table: string) => Number(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n);

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    void ADMIN;
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES ('pedro', 'Pedro Paez', '5', ?, 1000, 1000)`).run(OWNER);
    sqlite.prepare(`INSERT INTO households (id, created_by, created_at) VALUES ('hh1', ?, 1000)`).run(OWNER);
    sqlite.prepare(`INSERT INTO household_memberships (id, household_id, adopter_id, relationship, gift_recipient, added_by, added_at) VALUES ('m1', 'hh1', 'pedro', 'unknown', 0, NULL, 1000)`).run();
    sqlite.prepare(`INSERT INTO household_corrections (id, household_id, adopter_id, corrected_by, corrected_at, snapshot) VALUES ('c1', 'hh1', 'pedro', ?, 1000, '{}')`).run(OWNER);
    sqlite.prepare(`INSERT INTO household_conversions (source_key, host_adopter_id, outcome, converted_at) VALUES ('inline:pedro:x', 'pedro', 'converted', 1000)`).run();
});

describe('purgeAllData', () => {
    it('clears the household tables with the adopters', async () => {
        expect(await purgeAllData('PURGE-ALL-DATA')).toMatchObject({ success: true });
        for (const t of ['adopters', 'households', 'household_memberships', 'household_corrections', 'household_conversions']) expect(count(t), t).toBe(0);
    });
});
