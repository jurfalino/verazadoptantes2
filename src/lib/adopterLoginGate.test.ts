/**
 * The adopter sign-in gate (src/lib/adopterLoginGate.ts): an email that matches
 * a profile is blocked when that profile is SHOWN as 1★ or has one of the two
 * period ALERTS exactly as the profile shows them (periodAlerts — requests per
 * rescue). Flags never block: they ask for an action, they don't say the
 * person can't be trusted (Jon, 2026-11-07). A profile the signing-in rescuer
 * added themselves never blocks them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));
vi.mock('@/app/actions/_db', () => ({ getDb: async () => state.db, getUser: async () => null }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/lib/logger', async (orig) => ({ ...(await orig<typeof import('@/lib/logger')>()), logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') } }));

import { checkAdopterLoginGate } from './adopterLoginGate';

type Row = Record<string, unknown>;
let sqlite: { prepare: (s: string) => { run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Row[] } };

const EMAIL = 'persona@example.com';
const RESCUER = 'rescate@example.com';
const DAY = 86400;
const now = () => Math.floor(Date.now() / 1000);

function person(id: string, addedBy = RESCUER) {
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by) VALUES (?, ?, '5', ?)`).run(id, id, addedBy);
    sqlite.prepare(`INSERT INTO duplicate_tokens (id, adopter_id, token_type, token_value) VALUES (?, ?, 'email', ?)`).run(`t-${id}`, id, EMAIL);
}
let n = 0;
/** A record with no animal (the `adoptions` view reads these from adopter_events). */
function record(adopterId: string, type: string, opts: { rating?: number | null; daysAgo?: number; by?: string } = {}) {
    sqlite.prepare(`INSERT INTO adopter_events (id, adopter_id, event_type, rating, date, recorded_by) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(`e${n++}`, adopterId, type, opts.rating ?? null, now() - (opts.daysAgo ?? 1) * DAY, opts.by ?? RESCUER);
}

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as typeof sqlite;
    // Admin thresholds as in production on 2026-11-07: 2 adoptions in 10 days, 3 rescues in 30.
    const cfg = sqlite.prepare(`INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)`);
    for (const [k, v] of [['too_many_adoptions_threshold', '2'], ['too_many_adoptions_period_days', '10'], ['too_many_requests_threshold', '3'], ['too_many_requests_period_days', '30']]) cfg.run(k, v);
});

describe('adopter sign-in gate', () => {
    it('no profile with that email: signs in', async () => {
        expect((await checkAdopterLoginGate(EMAIL)).blocked).toBe(false);
    });

    it('shown as 1★: blocked (low_rating); 2★ signs in', async () => {
        person('p1');
        record('p1', 'observation', { rating: 1 });
        expect(await checkAdopterLoginGate(EMAIL)).toMatchObject({ blocked: true, reason: 'low_rating' });
        record('p1', 'observation', { rating: 3 });
        expect((await checkAdopterLoginGate(EMAIL)).blocked).toBe(false);
    });

    it('the too_many_adoptions alert, with the Admin thresholds: blocked', async () => {
        person('p1');
        record('p1', 'adoption', { daysAgo: 3 });
        expect((await checkAdopterLoginGate(EMAIL)).blocked).toBe(false);
        record('p1', 'adoption', { daysAgo: 1 });
        expect(await checkAdopterLoginGate(EMAIL)).toMatchObject({ blocked: true, reason: 'too_many_adoptions' });
    });

    it('requests count RESCUES, as the alert does: three to one rescue sign in, three rescues are blocked', async () => {
        person('p1');
        for (const d of [1, 2, 3]) record('p1', 'adoption_request', { daysAgo: d });
        expect((await checkAdopterLoginGate(EMAIL)).blocked).toBe(false);
        record('p1', 'adoption_request', { daysAgo: 2, by: 'otro@example.com' });
        record('p1', 'adoption_request', { daysAgo: 3, by: 'tercero@example.com' });
        expect(await checkAdopterLoginGate(EMAIL)).toMatchObject({ blocked: true, reason: 'too_many_requests' });
    });

    it('flags never block — an open duplicate report, an inaccuracy report', async () => {
        person('p1');
        person('p2');
        const flag = sqlite.prepare(`INSERT INTO adopter_flags (id, adopter_id, flagged_by, reason, target_adopter_id) VALUES (?, ?, ?, ?, ?)`);
        flag.run('f1', 'p1', RESCUER, 'duplicate', 'p2');
        flag.run('f2', 'p1', RESCUER, 'inaccurate_information', null);
        expect((await checkAdopterLoginGate(EMAIL)).blocked).toBe(false);
    });

    it('a profile the signing-in person added themselves never blocks them', async () => {
        person('p1', EMAIL);
        record('p1', 'observation', { rating: 1 });
        expect((await checkAdopterLoginGate(EMAIL)).blocked).toBe(false);
    });
});
