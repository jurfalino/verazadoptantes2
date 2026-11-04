/**
 * The public API's `flags` follow the app (Jon, 2026-10-28): `inaccurate` and
 * `duplicate` are the person's open alerts by the profile header's one rule
 * (openAlertKinds). A duplicate report counts only while it is open — it names
 * the other profile and nobody has merged them or kept them separate; one
 * closed by a merge or a «mantener separados» is history and is not reported.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));
vi.mock('@/app/actions/_db', () => ({ getDb: async () => state.db, getUser: async () => 'api@example.com' }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/lib/logger', async (orig) => ({ ...(await orig<typeof import('@/lib/logger')>()), logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') }, generateErrorId: () => 'gen12345' }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/requestContext', () => ({ getRequestContext: () => ({ env: {} }) }));

import { buildProfileSummaries } from './profiles';
import { openAlertKindsOfRows } from '@/domain/flags';
import { MERGED_FLAG_DETAILS_PREFIX, KEPT_SEPARATE_FLAG_DETAILS_PREFIX } from '@/domain/dedupPair';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };

// migratedDb is the SYNC better-sqlite3 driver; D1 returns promises and the reads chain .catch on them.
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

const PEOPLE = ['open', 'merged', 'kept', 'untargeted', 'legacy', 'current', 'other'];

beforeEach(() => {
    const m = migratedDb();
    state.db = asyncDb(m.db);
    sqlite = m.sqlite as unknown as typeof sqlite;
    const insertAdopter = sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by) VALUES (?, ?, '5', 'o@example.com')`);
    for (const id of PEOPLE) insertAdopter.run(id, id);
    const flag = sqlite.prepare(`INSERT INTO adopter_flags (id, adopter_id, flagged_by, reason, target_adopter_id, details, created_at) VALUES (?, ?, 'o@example.com', ?, ?, ?, 1)`);
    flag.run('f-open', 'open', 'duplicate', 'other', null);
    flag.run('f-merged', 'merged', 'duplicate', 'other', `${MERGED_FLAG_DETAILS_PREFIX}other by admin@example.com`);
    flag.run('f-kept', 'kept', 'duplicate', 'other', `${KEPT_SEPARATE_FLAG_DETAILS_PREFIX}not the same person`);
    flag.run('f-untargeted', 'untargeted', 'duplicate', null, null);
    flag.run('f-legacy', 'legacy', 'inaccurate', null, null);
    flag.run('f-current', 'current', 'inaccurate_information', null, null);
});

const summaries = () => buildProfileSummaries(state.db, PEOPLE, 'https://example.org', 'req-1', 'api@example.com');

describe('the API flags follow the app (open duplicate reports only)', () => {
    it('an open duplicate report is reported', async () => {
        expect((await summaries()).get('open')?.flags).toEqual(['duplicate']);
    });

    it('a closed duplicate report — merged or kept separate — is not', async () => {
        const s = await summaries();
        expect(s.get('merged')?.flags).toEqual([]);
        expect(s.get('kept')?.flags).toEqual([]);
    });

    it('a duplicate report that never named the other profile is not an open question either', async () => {
        expect((await summaries()).get('untargeted')?.flags).toEqual([]);
    });

    it('inaccurate: the current reason and the legacy one, as the profile header counts them', async () => {
        const s = await summaries();
        expect(s.get('current')?.flags).toEqual(['inaccurate']);
        expect(s.get('legacy')?.flags).toEqual(['inaccurate']);
    });

    it('every profile: the API says exactly what the profile header draws', async () => {
        const s = await summaries();
        const rows = sqlite.prepare(`SELECT adopter_id AS adopterId, reason, target_adopter_id AS targetAdopterId, details FROM adopter_flags`).all() as Array<{ adopterId: string; reason: string; targetAdopterId: string | null; details: string | null }>;
        for (const id of PEOPLE) {
            const header = openAlertKindsOfRows(rows.filter(r => r.adopterId === id));
            expect(s.get(id)?.flags.filter(f => f === 'inaccurate' || f === 'duplicate'), id).toEqual(header);
        }
    });
});
