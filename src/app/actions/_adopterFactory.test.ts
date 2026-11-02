/**
 * findAndPersistDuplicateCandidates on the identity verdict: every same/possible
 * match becomes a pending «Pendientes de revisar» pair (confidence from the
 * verdict, score = relevancePercent), over real SQL and the real token index.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));

vi.mock('@/app/actions/_db', () => ({ getDb: async () => state.db, getUser: async () => 'rescuer@example.com' }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/lib/requestContext', () => ({ getRequestContext: () => ({ env: {} }) }));
vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
    withTrace: (_op: string, fn: () => unknown) => fn(),
}));
vi.mock('@/lib/identityMatch', async (orig) => {
    const real = await orig<typeof import('@/lib/identityMatch')>();
    return { ...real, findPersonMatches: vi.fn(real.findPersonMatches) };
});

import { tokenizeAdopter } from '@/lib/adopterTokenize';
import { contactEntriesToBlob, type ContactEntry } from '@/lib/contactEntries';
import { findPersonMatches } from '@/lib/identityMatch';
import { logger } from '@/lib/logger';
import { findAndPersistDuplicateCandidates } from './_adopterFactory';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };
const OWNER = 'rescuer@example.com';

const e = (type: ContactEntry['type'], value: string, platform?: string): ContactEntry =>
    ({ id: `${type}-${value}`, type, value, ...(platform ? { platform } : {}), addedBy: OWNER } as ContactEntry);

async function seed(id: string, name: string, entries: ContactEntry[]) {
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, country, created_at, updated_at, contact_entries, contact_info)
        VALUES (?, ?, '5', ?, 'AR', 1000, 1000, ?, ?)`)
        .run(id, name, OWNER, JSON.stringify(entries), contactEntriesToBlob(entries));
    await tokenizeAdopter(id);
}
const db = () => state.db as Parameters<typeof findAndPersistDuplicateCandidates>[0];
const pairs = () => sqlite.prepare('SELECT adopter1_id AS a, adopter2_id AS b, status, confidence, score FROM duplicate_candidates').all();
const pairWith = (other: string) => pairs().find(p => p.a === other || p.b === other);

beforeEach(async () => {
    vi.clearAllMocks();
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    await seed('mj', 'María José Pérez', [e('phone', '+54 9 11 6585 1333'), e('id', '30123456')]);
    await seed('mp', 'María Pérez', [e('phone', '+54 9 11 4444 5555')]);
    await seed('new', 'Incoming', []);
});

describe('findAndPersistDuplicateCandidates on the verdict', () => {
    it('same full name, another phone: pairs with María José and María (possible → medium)', async () => {
        const res = await findAndPersistDuplicateCandidates(db(), 'new', { name: 'María José Pérez', phone: '11 2222-3333' });
        expect(res.map(r => r.adopterId).sort()).toEqual(['mj', 'mp']);
        expect(pairs().map(p => [p.a === 'new' ? p.b : p.a, p.status, p.confidence]).sort()).toEqual([['mj', 'pending', 'medium'], ['mp', 'pending', 'medium']]);
    });

    it("another name on María José's phone: pair with her, medium", async () => {
        await findAndPersistDuplicateCandidates(db(), 'new', { name: 'Juan Carlos Ruiz', phone: '11 6585-1333' });
        expect(pairs()).toHaveLength(1);
        expect(pairWith('mj')).toMatchObject({ status: 'pending', confidence: 'medium' });
    });

    it('a DNI + a compatible name is the same person: high, score is the relevance', async () => {
        const res = await findAndPersistDuplicateCandidates(db(), 'new', { name: 'María José Pérez', documentId: '30.123.456' });
        expect(res[0].adopterId).toBe('mj');
        expect(pairWith('mj')).toMatchObject({ status: 'pending', confidence: 'high', score: res[0].relevancePercent });
    });

    it('a DNI + another name is possible, like a phone: medium (Jon 2026-11-02)', async () => {
        const res = await findAndPersistDuplicateCandidates(db(), 'new', { name: 'Majo Pérez', documentId: '30.123.456' });
        expect(res.map(r => r.adopterId)).toEqual(['mj']);
        expect(pairWith('mj')).toMatchObject({ status: 'pending', confidence: 'medium' });
    });

    it('never writes low, and leaves an already dismissed pair untouched', async () => {
        const [a, b] = ['mj', 'new'];
        sqlite.prepare(`INSERT INTO duplicate_candidates (id, adopter1_id, adopter2_id, match_types, score, confidence, status, detected_at)
            VALUES ('d1', ?, ?, '[]', 10, 'low', 'dismissed', 1000)`).run(a, b);
        await findAndPersistDuplicateCandidates(db(), 'new', { name: 'María José Pérez', phone: '11 2222-3333' });
        expect(sqlite.prepare("SELECT status, confidence, score FROM duplicate_candidates WHERE id = 'd1'").all()).toEqual([{ status: 'dismissed', confidence: 'low', score: 10 }]);
        expect(pairs().filter(p => p.confidence === 'low')).toHaveLength(1);
        expect(pairs()).toHaveLength(2);
    });

    it('skipPair still drops a pair before it is written or returned', async () => {
        const res = await findAndPersistDuplicateCandidates(db(), 'new', { name: 'María José Pérez', phone: '11 2222-3333' }, { skipPair: async o => o === 'mp' });
        expect(res.map(r => r.adopterId)).toEqual(['mj']);
        expect(pairs()).toHaveLength(1);
        expect(pairWith('mp')).toBeUndefined();
    });

    it('a retrieval failure gives [], warns with the adopter id and no contact values, writes nothing', async () => {
        vi.mocked(findPersonMatches).mockRejectedValueOnce(new Error('Failed query: select 1\nparams: 1165851333,6585'));
        const res = await findAndPersistDuplicateCandidates(db(), 'new', { name: 'María José Pérez', phone: '11 6585-1333' }, { ctx: { op: 'x' } });
        expect(res).toEqual([]);
        expect(pairs()).toHaveLength(0);
        const call = vi.mocked(logger.warn).mock.calls.find(c => String(c[0]).includes('findAndPersistDuplicateCandidates'));
        expect(call?.[1]).toMatchObject({ op: 'x', adopterId: 'new' });
        expect(JSON.stringify(call?.[1])).not.toContain('6585');
    });

    it('the new profile does not count as a name holding the phone: 3 other names + the tokenized newcomer still pair with all 3', async () => {
        for (const [id, n] of [['a1', 'Ana Ruiz'], ['a2', 'Bea Soto'], ['a3', 'Ceci Luna']]) await seed(id, n, [e('phone', '+54 9 11 3030 4040')]);
        await seed('dora', 'Dora Vega', [e('phone', '+54 9 11 3030 4040')]);
        const res = await findAndPersistDuplicateCandidates(db(), 'dora', { name: 'Dora Vega', phone: '11 3030-4040' });
        expect(res.map(r => r.adopterId).sort()).toEqual(['a1', 'a2', 'a3']);
        expect(pairs()).toHaveLength(3);
    });

    it('candidates that skipPair drops cannot crowd a real one out of a tight limit/keep', async () => {
        for (const id of ['h1', 'h2']) await seed(id, 'Zoe Gomez', [e('phone', '+54 9 11 4545 6767')]);
        await seed('outsider', 'Rita Sosa', [e('phone', '+54 9 11 4545 6767')]);
        await seed('zoe', 'Zoe Gomez', [e('phone', '+54 9 11 4545 6767')]);
        const res = await findAndPersistDuplicateCandidates(db(), 'zoe', { name: 'Zoe Gomez', phone: '11 4545-6767' }, {
            skipPair: async o => o === 'h1' || o === 'h2', limit: 3, keep: 1,
        });
        expect(res.map(r => r.adopterId)).toEqual(['outsider']);
        expect(pairs().map(p => [p.a, p.b].sort())).toEqual([['outsider', 'zoe']]);
    });
});
