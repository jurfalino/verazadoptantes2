/**
 * sharesAnOrgStrict: the team check behind who gets a form's email
 * (src/app/api/form/[userId]/submit/route.ts). Member rows keep the session
 * email as it was, so both sides compare case-insensitively. Real SQL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { sharesAnOrgStrict } from './orgMembership';

type Sqlite = { prepare: (s: string) => { run: (...a: unknown[]) => unknown } };
let sqlite: Sqlite;

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as Sqlite;
    const add = sqlite.prepare(`INSERT INTO org_members (id, org_id, user_email) VALUES (?, ?, ?)`);
    add.run('m1', 'org-1', 'Ana@Example.com');
    add.run('m2', 'org-1', 'BEA@example.com');
    add.run('m3', 'org-2', 'zoe@other.org');
});

describe('sharesAnOrgStrict', () => {
    it('teammates, whatever the case on either side', async () => {
        expect(await sharesAnOrgStrict('ana@example.com', 'bea@example.com')).toBe(true);
        expect(await sharesAnOrgStrict(' ANA@example.com', 'Bea@Example.com ')).toBe(true);
    });
    it('another group, or nobody', async () => {
        expect(await sharesAnOrgStrict('ana@example.com', 'zoe@other.org')).toBe(false);
        expect(await sharesAnOrgStrict('nobody@example.com', 'bea@example.com')).toBe(false);
    });
    it('the same person is not their own teammate', async () => {
        expect(await sharesAnOrgStrict('ana@example.com', 'ANA@example.com')).toBe(false);
    });
    it('throws when the read fails (the caller tells "failed" from "stranger")', async () => {
        state.db = { select: () => ({ from: () => ({ where: () => Promise.reject(new Error('D1 down')) }) }) };
        await expect(sharesAnOrgStrict('ana@example.com', 'bea@example.com')).rejects.toThrow('D1 down');
    });
});
