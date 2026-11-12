/**
 * The country rule of a search (Jon, 2026-11-12), on a real migrated SQLite:
 * a search shows the viewer's current account country, plus — always — every
 * profile the viewer or their group loaded, whatever its country.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));

vi.mock('@/app/actions/_db', () => ({ getDb: async () => state.db, getUser: async () => 'me@example.com' }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
// The viewer's account country: Argentina.
vi.mock('@/lib/requestContext', () => ({
    getRequestContext: () => ({ env: { DB: { prepare: () => ({ bind: () => ({ first: async () => ({ country: 'AR' }) }) }) } } }),
}));
// The viewer's group: themself and one group-mate (email case as stored). The real
// lookup is covered by orgMembership's own tests; the test DB answers synchronously.
vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig<typeof import('@/lib/orgMembership')>()),
    getTeamEmails: vi.fn(async () => ['me@example.com', 'Mate@Example.com']),
}));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async (_n: string, task: () => Promise<unknown>) => { await task(); }) }));
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
    withTrace: (_op: string, fn: () => unknown) => fn(),
}));

import { tokenizeAdopter } from '@/lib/adopterTokenize';
import { contactEntriesToBlob, type ContactEntry } from '@/lib/contactEntries';
import { findAdoptersAsViewer } from './findAdopters';

type Sqlite = { prepare: (s: string) => { run: (...a: unknown[]) => unknown } };
let sqlite: Sqlite;
const ME = 'me@example.com';

async function seed(id: string, name: string, phone: string, addedBy: string, country: string) {
    const entries = [{ id: `phone-${id}`, type: 'phone', value: phone, addedBy } as ContactEntry];
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, country, created_at, updated_at, contact_entries, contact_info)
        VALUES (?, ?, '5', ?, ?, 1000, 1000, ?, ?)`)
        .run(id, name, addedBy, country, JSON.stringify(entries), contactEntriesToBlob(entries));
    await tokenizeAdopter(id);
}

const found = async (raw: string) => {
    const res = await findAdoptersAsViewer({ raw }, { enrich: true }, ME);
    return [...res.results, ...(res.lowRelevanceResults ?? [])].map(r => r.adopterId);
};

beforeEach(async () => {
    vi.clearAllMocks();
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as Sqlite;
    await seed('ar-stranger', 'Rosa Quiroga', '+54 9 11 5555-1111', 'stranger@example.com', 'AR');
    await seed('cl-stranger', 'Rosa Quintana', '+56 9 5555 2222', 'stranger@example.com', 'CL');
    await seed('cl-mine', 'Rosa Quevedo', '+56 9 5555 3333', ME, 'CL');
    await seed('cl-mate', 'Rosa Quinteros', '+56 9 5555 4444', 'mate@example.com', 'CL');
});

describe('search by name', () => {
    it('shows my country, mine and my group\'s — not another country\'s stranger', async () => {
        const ids = await found('Rosa');
        expect(ids).toEqual(expect.arrayContaining(['ar-stranger', 'cl-mine', 'cl-mate']));
        expect(ids).not.toContain('cl-stranger');
    });
});

describe('search by phone', () => {
    it('finds my group-mate\'s profile from another country', async () => {
        expect(await found('+56 9 5555 4444')).toContain('cl-mate');
    });
    it('still hides another country\'s stranger', async () => {
        expect(await found('+56 9 5555 2222')).not.toContain('cl-stranger');
    });
});
