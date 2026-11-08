/**
 * The public API's `flags` follow the app (Jon, 2026-10-28): `duplicate` by the
 * profile header's one rule (openFlagKinds) — a report counts only while it is
 * open: it names the other profile and nobody has merged them or kept them
 * separate; one closed by a merge or a «mantener separados» is history and is
 * not reported. `inaccurate` is never returned: as in the app, only admins see
 * it (Jon, 2026-11-07). The API's `alerts` carry the search card's two housemate
 * chips, read strictly: a failed read is a 503, never «no alerts».
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown, households: true } }));
vi.mock('@/app/actions/_db', () => ({ getDb: async () => state.db, getUser: async () => 'api@example.com' }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/lib/logger', async (orig) => ({ ...(await orig<typeof import('@/lib/logger')>()), logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') }, generateErrorId: () => 'gen12345' }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/requestContext', () => ({ getRequestContext: () => ({ env: {} }) }));
vi.mock('@/config/features', async (orig) => {
    const real = await orig<typeof import('@/config/features')>();
    return { ...real, getFeatureFlag: vi.fn(async (flag: Parameters<typeof real.getFeatureFlag>[0], o?: { onReadError?: boolean }) => flag === 'ENABLE_HOUSEHOLD_MEMBERS' ? state.households : real.getFeatureFlag(flag, o)) };
});

import { buildProfileSummaries } from './profiles';
import { openFlagKindsOfRows, rescuerFlagKinds } from '@/domain/flags';
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

    it('inaccurate — the current reason and the legacy one — is never returned: only admins see it, as in the app', async () => {
        const s = await summaries();
        expect(s.get('current')?.flags).toEqual([]);
        expect(s.get('legacy')?.flags).toEqual([]);
    });

    it('every profile: the API says exactly what the profile header draws for a rescuer', async () => {
        const s = await summaries();
        const rows = sqlite.prepare(`SELECT adopter_id AS adopterId, reason, target_adopter_id AS targetAdopterId, details FROM adopter_flags`).all() as Array<{ adopterId: string; reason: string; targetAdopterId: string | null; details: string | null }>;
        for (const id of PEOPLE) {
            const header = rescuerFlagKinds(openFlagKindsOfRows(rows.filter(r => r.adopterId === id)));
            expect(s.get(id)?.flags.filter(f => f === 'duplicate'), id).toEqual(header);
        }
    });
});

/**
 * «Identidad / Dirección Verificada» — the profile header's rule (cards V1/V2,
 * profileVerifications): from the records as they are now. A record where the
 * ID was checked counts (the API used to read only a stored mark nothing writes);
 * a stored «verified_address» row with no record behind it does not.
 */
describe('the API verification flags follow the records (V1/V2)', () => {
    const placement = (id: string, adopterId: string, cols: { identity?: number; delivered?: number; address?: string | null }) => {
        sqlite.prepare(`INSERT INTO animals (id, name, species, added_by, created_at, updated_at) VALUES (?, 'Nina', 'cat', 'o@example.com', 1000, 1000)`).run(`an-${id}`);
        sqlite.prepare(`INSERT INTO placements (id, animal_id, adopter_id, record_type, started_at, status, recorded_by, identity_verified, delivered_to_home, verified_address)
            VALUES (?, ?, ?, 'adoption', 1000, 'completed', 'o@example.com', ?, ?, ?)`).run(id, `an-${id}`, adopterId, cols.identity ?? null, cols.delivered ?? null, cols.address ?? null);
    };
    it('a record with the ID checked → verified_identity; delivered home with its address → verified_address', async () => {
        placement('p1', 'other', { identity: 1, delivered: 1, address: 'Calle Falsa 123' });
        const flags = (await summaries()).get('other')?.flags;
        expect(flags).toContain('verified_identity');
        expect(flags).toContain('verified_address');
    });
    it('a stored «verified_address» row whose record was un-ticked is not a verified address', async () => {
        placement('p2', 'other', { delivered: 0, address: null });
        sqlite.prepare(`INSERT INTO adopter_flags (id, adopter_id, flagged_by, reason, details, created_at) VALUES ('f-va', 'other', 'o@example.com', 'verified_address', 'Address verified during pet delivery: Calle Falsa 123', 1)`).run();
        expect((await summaries()).get('other')?.flags).not.toContain('verified_address');
    });
});

describe('the API alerts carry the housemate chips (Jon, 2026-11-07)', () => {
    const OWNER = 'o@example.com';
    beforeEach(async () => {
        state.households = true;
        // «open» lives with «merged» (rated 2★ and 1★ → the lowest) and with «kept», who asked at 3 rescues in 3 days.
        // Records without an animal (the `adoptions` view reads them from adopter_events).
        const rec = sqlite.prepare(`INSERT INTO adopter_events (id, adopter_id, event_type, rating, date, recorded_by) VALUES (?, ?, ?, ?, ?, ?)`);
        rec.run('p1', 'merged', 'observation', 2, 1000, OWNER);
        rec.run('p2', 'merged', 'observation', 1, 1000, OWNER);
        const now = Math.floor(Date.now() / 1000);
        for (const [i, by] of ['r1@example.com', 'r2@example.com', 'r3@example.com'].entries()) rec.run(`q${i}`, 'kept', 'adoption_request', null, now - i * 86400, by);
        sqlite.prepare(`INSERT INTO households (id, created_by, created_at) VALUES ('hh-1', ?, 1000)`).run(OWNER);
        const member = sqlite.prepare(`INSERT INTO household_memberships (id, household_id, adopter_id, added_by, added_at) VALUES (?, 'hh-1', ?, ?, 1000)`);
        for (const p of ['open', 'merged', 'kept']) member.run(`m-${p}`, p, OWNER);
    });

    it('someone in the home rated 1★ or 2★ → housemate_low_rating with the lowest rating; one with an alert → housemate_alerts', async () => {
        const s = await summaries();
        expect(s.get('open')?.alerts).toEqual([
            { type: 'housemate_low_rating', rating: 1.5, ratingLevel: 2, ratingLabel: 'poor' },
            { type: 'housemate_alerts' },
        ]);
        // «kept» has the alert of its own, and lives with the 1.5★ person.
        expect(s.get('kept')?.alerts.map(a => a.type)).toEqual(['too_many_requests', 'housemate_low_rating']);
        // Nobody in a home: no housemate alert.
        expect(s.get('other')?.alerts).toEqual([]);
    });

    it('households switched off: no housemate alerts', async () => {
        state.households = false;
        expect((await summaries()).get('open')?.alerts).toEqual([]);
    });

    it('a failed housemate read fails the call (503), never answers «no alerts»', async () => {
        const real = sqlite.prepare.bind(sqlite);
        sqlite.prepare = ((q: string) => {
            if (/household_memberships/.test(q) && /json_object/.test(q)) throw new Error('D1 hiccup');
            return real(q);
        }) as typeof sqlite.prepare;
        await expect(summaries()).rejects.toMatchObject({ status: 503 });
    });

    it('a failed read of the Admin thresholds fails the call (503) — never alerts judged by the looser defaults', async () => {
        const real = sqlite.prepare.bind(sqlite);
        // getAdoptionConfig reads the whole table (a feature flag reads one key, with a WHERE).
        sqlite.prepare = ((q: string) => {
            if (/from "app_config"/.test(q) && !/where/i.test(q)) throw new Error('D1 hiccup');
            return real(q);
        }) as typeof sqlite.prepare;
        await expect(summaries()).rejects.toMatchObject({ status: 503 });
    });
});
