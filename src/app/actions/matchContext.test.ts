/**
 * getMatchContext's opt-in standing (audit B6): the post import's match cards
 * show the matched person's own rating / alerts or «Menor de edad», like every
 * other match card. Off by default (MatchCompare asks only for `has`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown, user: 'rescuer@example.com' } }));
vi.mock('./_db', () => ({ getDb: async () => state.db, getUser: async () => state.user }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/lib/logger', async (orig) => ({ ...(await orig<typeof import('@/lib/logger')>()), logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') }, generateErrorId: () => 'gen12345' }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/requestContext', () => ({ getRequestContext: () => ({ env: {} }) }));

import { getMatchContext } from './matchContext';
import { hydrateDuplicateMatches } from './hydrateDuplicateMatches';
import { openAlertKinds } from '@/domain/flags';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { run: (...a: unknown[]) => unknown; get: (...a: unknown[]) => Row | undefined } };

// migratedDb is the SYNC better-sqlite3 driver; production D1 returns promises and the
// duplicate search chains .catch on them. Make the terminal calls async (as D1's are).
function asyncDb<T extends object>(target: T): T {
    return new Proxy(target, {
        get(t, p, r) {
            const v = Reflect.get(t, p, r);
            if (typeof v !== 'function') return v;
            return (...args: unknown[]) => {
                const out = (v as (...a: unknown[]) => unknown).apply(t, args);
                if (p === 'get' || p === 'all' || p === 'run' || p === 'values') return Promise.resolve(out);
                return out && typeof out === 'object' && p !== 'then' ? asyncDb(out as object) : out;
            };
        },
    });
}

beforeEach(() => {
    const m = migratedDb();
    state.db = asyncDb(m.db);
    sqlite = m.sqlite as unknown as typeof sqlite;
    state.user = 'rescuer@example.com';
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, is_minor) VALUES ('lucas', 'Lucas', '5', 'o@example.com', 1), ('pedro', 'Pedro', '5', 'o@example.com', 0)`).run();
    sqlite.prepare(`INSERT INTO adopter_events (id, adopter_id, event_type, rating) VALUES ('r1', 'pedro', 'observation', 2)`).run();
    sqlite.prepare(`INSERT INTO adopter_flags (id, adopter_id, flagged_by, reason, created_at) VALUES ('f1', 'pedro', 'o@example.com', 'inaccurate_information', 1)`).run();
});

describe('getMatchContext — standing', () => {
    it('only when asked', async () => {
        expect((await getMatchContext('pedro')).standing).toBeUndefined();
    });
    it('an adult: their rating and open alerts; a minor: «Menor de edad»', async () => {
        expect((await getMatchContext('pedro', { standing: true })).standing).toMatchObject({ rating: 2, openAlerts: ['inaccurate'], isMinor: false, households: [] });
        expect((await getMatchContext('lucas', { standing: true })).standing).toMatchObject({ isMinor: true });
    });
    it('signed out: nothing', async () => {
        state.user = '';
        expect(await getMatchContext('pedro', { standing: true })).toMatchObject({ ok: false });
        expect((await getMatchContext('pedro', { standing: true })).standing).toBeUndefined();
    });
});

/**
 * Fix round 2, item 23: getMatchContext is browser-callable by any signed-in
 * rescuer, so it never says more than the duplicate search (the import's match
 * list, hydrateDuplicateMatches) says to the same caller: nothing about a
 * merged-away / soft-deleted profile, and a standing that is exactly the
 * search result's own rating, alerts, minor tag and household line.
 */
describe('getMatchContext — never more than the duplicate search', () => {
    const stub = (adopterId: string) => ({ adopterId, adopterName: '', relevancePercent: 90, matchTypes: [], matchValues: [], source: 'token' as const });

    it('a merged-away (soft-deleted) profile: nothing, with or without standing — as the search, which skips it', async () => {
        sqlite.prepare(`UPDATE adopters SET deleted_at = 1000 WHERE id = 'pedro'`).run();
        expect(await hydrateDuplicateMatches(state.db, [stub('pedro')], { viewer: state.user, isUnauthenticated: false })).toEqual([]);
        const withStanding = await getMatchContext('pedro', { standing: true });
        expect(withStanding).toMatchObject({ ok: false, name: null });
        expect(withStanding.standing).toBeUndefined();
        expect(await getMatchContext('pedro')).toMatchObject({ ok: false, name: null });
    });

    it('the standing is exactly what the duplicate search shows this caller about the person — no more fields', async () => {
        for (const id of ['pedro', 'lucas']) {
            const [m] = await hydrateDuplicateMatches(state.db, [stub(id)], { viewer: state.user, isUnauthenticated: false });
            const { standing } = await getMatchContext(id, { standing: true });
            expect(Object.keys(standing ?? {}).sort()).toEqual(['households', 'isMinor', 'openAlerts', 'rating']);
            expect(standing).toEqual({ rating: m.avgRating, openAlerts: openAlertKinds(m.flags), isMinor: !!m.isMinor, households: m.households ?? [] });
        }
    });
});
