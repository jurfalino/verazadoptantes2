/**
 * Search box and API fuzzy on the identity verdict: a profile the verdict calls «same» goes to the
 * top of the main list, only if the search already returned it. Plain-name queries ask nothing extra.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';

const { state, spy } = vi.hoisted(() => ({ state: { db: null as unknown }, spy: { fn: null as null | ((...a: unknown[]) => Promise<unknown>) } }));

vi.mock('@/app/actions/_db', () => ({ getDb: async () => state.db, getUser: async () => 'rescuer@example.com' }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/lib/requestContext', () => ({ getRequestContext: () => ({ env: {} }) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async (_n: string, task: () => Promise<unknown>) => { await task(); }) }));
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
    withTrace: (_op: string, fn: () => unknown) => fn(),
}));
vi.mock('@/lib/identityMatch', async (orig) => {
    const actual = await orig<typeof import('@/lib/identityMatch')>();
    return { ...actual, findPersonMatches: vi.fn((...a: Parameters<typeof actual.findPersonMatches>) => (spy.fn ? spy.fn(...a) : actual.findPersonMatches(...a))) };
});

import { tokenizeAdopter } from '@/lib/adopterTokenize';
import { contactEntriesToBlob, type ContactEntry } from '@/lib/contactEntries';
import { findAdoptersAsViewer } from './findAdopters';
import { findPersonMatches } from '@/lib/identityMatch';
import { logger } from '@/lib/logger';

type Sqlite = { prepare: (s: string) => { run: (...a: unknown[]) => unknown } };
let sqlite: Sqlite;
const OWNER = 'rescuer@example.com';
const e = (type: ContactEntry['type'], value: string): ContactEntry => ({ id: `${type}-${value}`, type, value, addedBy: OWNER } as ContactEntry);

async function seed(id: string, name: string, entries: ContactEntry[]) {
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, country, created_at, updated_at, contact_entries, contact_info)
        VALUES (?, ?, '5', ?, 'AR', 1000, 1000, ?, ?)`)
        .run(id, name, OWNER, JSON.stringify(entries), contactEntriesToBlob(entries));
    await tokenizeAdopter(id);
}

beforeEach(async () => {
    vi.clearAllMocks();
    spy.fn = null;
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as Sqlite;
    await seed('mj', 'María José Pérez', [e('email', 'maria.perez@gmail.com'), e('id', '30123456')]);
    await seed('mp', 'María Pérez', [e('phone', '+54 9 11 4444 5555')]);
});

const ids = (r: { adopterId: string }[]) => r.map(x => x.adopterId);

describe('discovery on the identity verdict', () => {
    it('a plain-name query makes no verdict call', async () => {
        const res = await findAdoptersAsViewer({ raw: 'María Pérez' }, { enrich: true }, OWNER);
        expect(res.results.length).toBeGreaterThan(0);
        expect(findPersonMatches).not.toHaveBeenCalled();
    });

    it('a phone query makes no verdict call', async () => {
        await findAdoptersAsViewer({ raw: '11 4444-5555' }, { enrich: true }, OWNER);
        expect(findPersonMatches).not.toHaveBeenCalled();
    });

    it('a typed email puts the person it identifies on top, pulled from the low list', async () => {
        const res = await findAdoptersAsViewer({ raw: 'Maria Peres maria.perez@gmail.com' }, { enrich: true }, OWNER);
        expect(findPersonMatches).toHaveBeenCalledTimes(1);
        expect(vi.mocked(findPersonMatches).mock.calls[0][1]).toMatchObject({ name: 'Maria Peres', emails: ['maria.perez@gmail.com'] });
        expect(ids(res.results)[0]).toBe('mj');
        expect(ids(res.lowRelevanceResults ?? [])).not.toContain('mj');
    });

    it('a typed DNI does the same', async () => {
        const res = await findAdoptersAsViewer({ raw: 'Majo Pérez 30.123.456' }, { enrich: true }, OWNER);
        expect(ids(res.results)).toEqual(['mj']);
    });

    it('never adds a profile the search did not return', async () => {
        spy.fn = async () => [{ adopterId: 'ghost', verdict: 'same' }, { adopterId: 'mp', verdict: 'possible' }];
        const res = await findAdoptersAsViewer({ raw: 'María Pérez' }, { enrich: true, identity: { name: 'María Pérez', emails: ['x@y.com'] } }, OWNER);
        const all = [...ids(res.results), ...ids(res.lowRelevanceResults ?? [])];
        expect(all).not.toContain('ghost');
    });

    it('a failed verdict keeps today\'s ranking and logs no query values', async () => {
        const before = await findAdoptersAsViewer({ raw: 'Maria Peres maria.perez@gmail.com' }, { enrich: true, identity: { name: 'x' } }, OWNER);
        spy.fn = async () => { throw new Error('boom params: maria.perez@gmail.com'); };
        const res = await findAdoptersAsViewer({ raw: 'Maria Peres maria.perez@gmail.com' }, { enrich: true }, OWNER);
        expect(ids(res.results)).toEqual(ids(before.results));
        const warn = vi.mocked(logger.warn).mock.calls.find(c => String(c[0]).includes('identity verdict'));
        expect(warn).toBeTruthy();
        expect(JSON.stringify(warn)).not.toContain('maria.perez@gmail.com');
    });
});
