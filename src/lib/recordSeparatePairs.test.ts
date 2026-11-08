/**
 * A household «No, es otra persona» must survive the duplicate Scan (spec
 * 2026-11-05, Verification: "no pending pair between the two, even after a
 * Scan"). The Scan's skip set and the save-time matcher both look a pair up
 * by its SORTED ids (adopter1_id < adopter2_id), so the row must be stored
 * that way whichever id is the new profile's. Real SQL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';

vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') },
    generateErrorId: () => 'gen12345',
}));

import { recordSeparatePairs } from './mergeRequests';

type Sqlite = { prepare: (s: string) => { all: (...a: unknown[]) => Array<Record<string, unknown>>; run: (...a: unknown[]) => unknown } };
let db: unknown;
let sqlite: Sqlite;

beforeEach(() => {
    const m = migratedDb();
    db = m.db;
    sqlite = m.sqlite as unknown as Sqlite;
});

describe('recordSeparatePairs stores the pair the way the Scan reads it', () => {
    it('a new profile whose id sorts AFTER the rejected one: stored as (rejected, new)', async () => {
        await recordSeparatePairs(db as never, 'z-new', ['a-old'], 'me@x.org');
        const rows = sqlite.prepare('SELECT adopter1_id, adopter2_id, status FROM duplicate_candidates').all();
        expect(rows).toEqual([{ adopter1_id: 'a-old', adopter2_id: 'z-new', status: 'dismissed' }]);
    });

    it('a new profile whose id sorts BEFORE the rejected one: stored as (new, rejected)', async () => {
        await recordSeparatePairs(db as never, 'a-new', ['z-old'], 'me@x.org');
        const rows = sqlite.prepare('SELECT adopter1_id, adopter2_id, status FROM duplicate_candidates').all();
        expect(rows).toEqual([{ adopter1_id: 'a-new', adopter2_id: 'z-old', status: 'dismissed' }]);
    });
});
