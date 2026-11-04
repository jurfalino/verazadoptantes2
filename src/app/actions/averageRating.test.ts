/**
 * One rule for «the person's rating», in every server path: records with a
 * rating of 0 or NULL are "not rated" and never pull the average down
 * ([4, 0] -> 4). Real SQL on the real schema.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import { getUser } from '@/test-utils/actionMocks';
import { computeAvgRating } from '@/domain/ratings';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));
vi.mock('./_db', () => ({ getDb: async () => state.db, getUser }));
vi.mock('@/lib/adopterTokenize', () => ({ tokenizeAdopter: vi.fn(async () => undefined) }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/requestContext', () => ({ getRequestContext: () => ({ env: {} }) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

import { getAverageRating } from './adopters';
import { countsFor } from '@/lib/profileSummary';

type Sqlite = { prepare: (s: string) => { run: (...a: unknown[]) => unknown } };
let sqlite: Sqlite;

function seed(id: string, ratings: Array<number | null>) {
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at) VALUES (?, 'Carla', '5', 'o@x.org', 1000, 1000)`).run(id);
    ratings.forEach((r, i) => sqlite.prepare(
        `INSERT INTO adopter_events (id, adopter_id, event_type, details, rating, date, recorded_by) VALUES (?, ?, 'observation', 'x', ?, 1000, 'o@x.org')`,
    ).run(`${id}-ev${i}`, id, r));
}

describe('average rating ignores 0 / NULL in every path', () => {
    beforeEach(() => {
        const m = migratedDb();
        state.db = m.db;
        sqlite = m.sqlite as unknown as Sqlite;
    });

    it('getAverageRating: [4, 0] -> 4, [4, null] -> 4, [0, null] -> null', async () => {
        seed('a1', [4, 0]);
        seed('a2', [4, null]);
        seed('a3', [0, null]);
        expect(await getAverageRating('a1')).toBe(4);
        expect(await getAverageRating('a2')).toBe(4);
        expect(await getAverageRating('a3')).toBeNull();
    });

    it('countsFor (search cards / summaries): [4, 0] -> 4', async () => {
        seed('a1', [4, 0]);
        seed('a3', [0, null]);
        expect((await countsFor(state.db as never, 'a1', {})).rating).toBe(4);
        expect((await countsFor(state.db as never, 'a3', {})).rating).toBeNull();
    });

    it('the SQL paths agree with the domain rule', async () => {
        seed('a1', [5, 3, 0, null]);
        expect(await getAverageRating('a1')).toBe(computeAvgRating([{ rating: 5 }, { rating: 3 }, { rating: 0 }, { rating: null }]));
    });
});
