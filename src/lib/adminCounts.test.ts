import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { getAdminCounts } from './adminCounts';

function seed(mergeStatuses: string[]) {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
        CREATE TABLE data_requests (id TEXT, status TEXT);
        CREATE TABLE pii_access_requests (id TEXT, status TEXT);
        CREATE TABLE merge_requests (id TEXT, status TEXT);
        INSERT INTO data_requests VALUES ('d1', 'pending'), ('d2', 'done');
        INSERT INTO pii_access_requests VALUES ('p1', 'pending'), ('p2', 'pending');
    `);
    mergeStatuses.forEach((s, i) => sqlite.prepare('INSERT INTO merge_requests VALUES (?, ?)').run(`m${i}`, s));
    state.db = drizzle(sqlite);
}

describe('getAdminCounts', () => {
    it('counts only pending merge requests (declined ones are not to-dos)', async () => {
        seed(['pending', 'pending', 'declined', 'admin_approved', 'cancelled', 'closed']);
        expect(await getAdminCounts()).toEqual({ dataRequests: 1, piiRequests: 2, mergeRequests: 2 });
    });
});
