/**
 * Mis animales on the homepage (spec 2026-11-10): the applications to evaluate
 * and the offers, read on the most visited page WITHOUT the heal write on its
 * path — the missing application rows are healed after the response
 * (runAfterResponse), so the next load counts them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import { asyncDb } from '@/test-utils/applicationFixtures';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown, req: {} as Headers } }));
vi.mock('@/app/actions/_db', () => ({ getDb: async () => state.db, getUser: async () => 'owner@example.com' }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/lib/logger', async (orig) => ({ ...(await orig<typeof import('@/lib/logger')>()), logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') } }));
vi.mock('next/headers', () => ({ headers: async () => state.req }));
vi.mock('@/lib/requestContext', () => ({ getRequestContext: () => ({ env: {} }) }));
vi.mock('@/config/features', () => ({ getFeatureFlag: async () => false }));
vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig<typeof import('@/lib/orgMembership')>()),
    getTeamEmails: async (e: string | null | undefined) => (e ? [e.trim().toLowerCase()] : []),
}));
vi.mock('@/lib/applicationWrites', async (orig) => {
    const real = await orig<typeof import('@/lib/applicationWrites')>();
    return { ...real, healMissingApplications: vi.fn(real.healMissingApplications) };
});
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async () => {}) }));

const { loadHomeAnimals } = await import('./homeModulesData');
const { countOpenByAnimal } = await import('@/lib/applicationCounts');
const { healMissingApplications } = await import('@/lib/applicationWrites');
const { runAfterResponse } = await import('@/lib/background');

const OWNER = 'owner@example.com';
type Sqlite = { prepare: (s: string) => { run: (...a: unknown[]) => unknown } };
let sqlite: Sqlite;

beforeEach(() => {
    vi.mocked(healMissingApplications).mockClear();
    vi.mocked(runAfterResponse).mockClear();
    const m = migratedDb();
    // The D1 shape (every .get/.all/.run a promise), as the home runs in production.
    state.db = asyncDb(m.db as object);
    state.req = new Headers();
    sqlite = m.sqlite as unknown as Sqlite;
    sqlite.prepare(`INSERT INTO animals (id, name, species, sex, added_by, created_at, updated_at) VALUES ('luna', 'Luna', 'cat', 'hembra', ?, 1000, 1000)`).run(OWNER);
    for (const id of ['a1', 'a2', 'a3']) sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by) VALUES (?, ?, '5', ?)`).run(id, id, OWNER);
    for (const [form, adopter] of [['f1', 'a1'], ['f2', 'a2']]) {
        sqlite.prepare(`INSERT INTO form_submissions (id, user_id, name, selected_animal_id, linked_adopter_id, created_at) VALUES (?, ?, ?, 'luna', ?, 1000)`).run(form, OWNER, form, adopter);
        sqlite.prepare(`INSERT INTO applications (id, submission_id, animal_id, origin, state) VALUES (?, ?, 'luna', 'form', 'open')`).run(`app-${form}`, form);
    }
    // A form whose application row is missing (a failed insert): only a heal makes it count.
    sqlite.prepare(`INSERT INTO form_submissions (id, user_id, name, selected_animal_id, linked_adopter_id, created_at) VALUES ('f3', ?, 'f3', 'luna', 'a3', 1000)`).run(OWNER);
});

describe('loadHomeAnimals — applications on the home', () => {
    it('counts the applications to evaluate per animal and the tab count', async () => {
        const d = await loadHomeAnimals(state.db, OWNER);
        const luna = d.rows.find(r => r.id === 'luna');
        expect(luna && 'toEvaluate' in luna ? luna.toEvaluate : null).toBe(2);
        expect(d.solicitudesCount).toBe(1);
        expect(d.moreApplications).toBe(0);
    });

    it('issues no heal write inline; the heal of the viewer\'s team is scheduled after the response', async () => {
        await loadHomeAnimals(state.db, OWNER);
        expect(healMissingApplications).not.toHaveBeenCalled();
        const calls = vi.mocked(runAfterResponse).mock.calls;
        expect(calls.length).toBeGreaterThanOrEqual(1);
        const [name, task] = calls[0];
        expect(name).toMatch(/heal/i);
        // Running the scheduled task heals the team's missing row; the next load counts it.
        await task();
        expect(healMissingApplications).toHaveBeenCalledWith(state.db, [OWNER]);
        state.req = new Headers();
        const next = await loadHomeAnimals(state.db, OWNER);
        const luna = next.rows.find(r => r.id === 'luna');
        expect(luna && 'toEvaluate' in luna ? luna.toEvaluate : null).toBe(3);
    });

    it('the scheduled heal runs after the count reads, and is the request\'s ONE heal of the team (final review I4)', async () => {
        const timeline: string[] = [];
        const ranAt: number[] = [];
        // Where the platform has no waitUntil the task runs at once: record when it was scheduled.
        vi.mocked(runAfterResponse).mockImplementation(async (_name, task) => { ranAt.push(timeline.length); timeline.push('heal'); await task(); });
        const realSelect = (state.db as { select: (...a: unknown[]) => unknown }).select.bind(state.db);
        state.db = new Proxy(state.db as object, {
            get(t, p, r) {
                if (p === 'select') return (...a: unknown[]) => { timeline.push('select'); return realSelect(...a); };
                return Reflect.get(t, p, r);
            },
        });
        const d = await loadHomeAnimals(state.db, OWNER);
        expect(ranAt).toHaveLength(1);
        // The grouped counts (to evaluate, offers, general) were all issued before the heal was scheduled.
        expect(timeline.slice(0, ranAt[0]).filter(x => x === 'select').length).toBeGreaterThanOrEqual(3);
        const luna = d.rows.find(r => r.id === 'luna');
        expect(luna && 'toEvaluate' in luna ? luna.toEvaluate : null).toBe(2); // the heal did not land before the read
        // Same request: a later count of the same team does not heal again.
        await countOpenByAnimal(state.db, [OWNER]);
        expect(healMissingApplications).toHaveBeenCalledTimes(1);
    });
});
