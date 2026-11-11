/**
 * /api/my-animals and «Con solicitudes por evaluar» (spec 2026-11-10,
 * «Destination pages»): the tab lists the animals with applications to
 * evaluate, scoped as the home counts them (applicationCounts, one grouped
 * query per animal-owner team, `takesContract`), and every tab list carries the
 * tab's count — «Sin animal elegido» included — so the tab label never waits
 * for its own list. Real SQL (migratedDb, the D1 promise shape), mocked session.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { migratedDb } from '@/test-utils/migratedDb';
import { asyncDb, adopter, animal, placement, form, application, type Sqlite } from '@/test-utils/applicationFixtures';

const OWNER = 'owner@example.com';
const STRANGER = 'stranger@example.com';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown, req: new Headers(), user: 'owner@example.com' as string | null } }));
vi.mock('@/auth', () => ({ auth: vi.fn(async () => (state.user ? { user: { email: state.user } } : null)) }));
vi.mock('@/app/actions/_db', () => ({ getDb: async () => state.db, getUser: async () => state.user }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/config/features', () => ({ getFeatureFlag: async (k: string) => k === 'ENABLE_ANIMALS_FOR_ADOPTION' }));
vi.mock('@/lib/logger', async (orig) => ({ ...(await orig<typeof import('@/lib/logger')>()), logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') } }));
vi.mock('next/headers', () => ({ headers: async () => state.req }));
vi.mock('@/lib/requestContext', () => ({ getRequestContext: () => ({ env: {} }) }));
vi.mock('@/app/actions/userNames', () => ({ resolveUserNames: async () => ({}) }));
vi.mock('@/lib/orgMembership', async (orig) => ({
    ...(await orig<typeof import('@/lib/orgMembership')>()),
    getTeamEmails: async (e: string | null | undefined) => (e ? [e.trim().toLowerCase()] : []),
}));

const { GET } = await import('./route');

let sqlite: Sqlite;

/**
 * OWNER's animals:
 *   luna  — available, 2 applications to evaluate
 *   tito  — fostered, 1 application to evaluate (fostered animals take contracts)
 *   ado   — adopted: an open application (never counted: no contract once adopted) and a candidate its adoption closed, not told yet (the offer)
 *   plain — available, no applications
 * plus 1 general application to evaluate («Sin animal elegido»). STRANGER's sol has one too (another team's).
 */
beforeEach(() => {
    const m = migratedDb();
    state.db = asyncDb(m.db as object);
    state.req = new Headers();
    state.user = OWNER;
    sqlite = m.sqlite as unknown as Sqlite;
    for (const id of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'home', 'foster']) adopter(sqlite, id, id, OWNER);
    adopter(sqlite, 'px', 'px', STRANGER);
    animal(sqlite, 'luna', 'Luna', OWNER);
    animal(sqlite, 'tito', 'Tito', OWNER, { sex: 'macho', species: 'dog' });
    animal(sqlite, 'ado', 'Ado', OWNER);
    animal(sqlite, 'plain', 'Plain', OWNER);
    animal(sqlite, 'sol', 'Sol', STRANGER);
    placement(sqlite, 'pl-tito', 'tito', 'foster', 'foster');
    placement(sqlite, 'pl-ado', 'ado', 'home', 'adoption');
    form(sqlite, 'f1', { adopter: 'p1', animal: 'luna' }); application(sqlite, 'app-f1', 'f1', 'luna');
    form(sqlite, 'f2', { adopter: 'p2', animal: 'luna' }); application(sqlite, 'app-f2', 'f2', 'luna');
    form(sqlite, 'f3', { adopter: 'p3', animal: 'tito' }); application(sqlite, 'app-f3', 'f3', 'tito');
    form(sqlite, 'f4', { adopter: 'p4', animal: 'ado' }); application(sqlite, 'app-f4', 'f4', 'ado');
    form(sqlite, 'f5', { adopter: 'p5', animal: 'ado' }); application(sqlite, 'app-f5', 'f5', 'ado', { state: 'closed', closeReason: 'adopted_other' });
    form(sqlite, 'f6', { adopter: 'p6' }); application(sqlite, 'app-f6', 'f6', null);
    form(sqlite, 'fx', { owner: STRANGER, adopter: 'px', animal: 'sol' }); application(sqlite, 'app-fx', 'fx', 'sol');
});

async function list(view: string) {
    state.req = new Headers(); // one request each (the per-request memo is keyed on it)
    const res = await GET(new NextRequest(`http://localhost/api/my-animals?view=${view}`));
    expect(res.status).toBe(200);
    const rows = await res.json() as Array<{ id: string; toEvaluate: number; offer: number }>;
    return { rows, solicitudes: res.headers.get('x-solicitudes-count'), general: res.headers.get('x-general-to-evaluate') };
}

describe('GET /api/my-animals — «Con solicitudes por evaluar»', () => {
    it('view=solicitudes lists only animals with applications to evaluate — fostered included, adopted excluded', async () => {
        const { rows } = await list('solicitudes');
        // Most waiting first.
        expect(rows.map(r => r.id)).toEqual(['luna', 'tito']);
        expect(rows.map(r => r.toEvaluate)).toEqual([2, 1]);
    });

    it('x-solicitudes-count = animals with toEvaluate + 1 for general; the same on every tab', async () => {
        for (const view of ['solicitudes', 'available', 'adopted', 'todos', 'pendientes']) {
            const { solicitudes, general } = await list(view);
            expect({ view, solicitudes, general }).toEqual({ view, solicitudes: '3', general: '1' });
        }
    });

    it('without general applications the count is the animals alone', async () => {
        sqlite.prepare(`UPDATE applications SET state = 'declined' WHERE id = 'app-f6'`).run();
        const { rows, solicitudes, general } = await list('solicitudes');
        expect(rows.map(r => r.id)).toEqual(['luna', 'tito']);
        expect([solicitudes, general]).toEqual(['2', '0']);
    });

    it('each row carries toEvaluate (0 when none)', async () => {
        const { rows } = await list('todos');
        const by = Object.fromEntries(rows.map(r => [r.id, r.toEvaluate]));
        expect(by).toEqual({ luna: 2, tito: 1, ado: 0, plain: 0 });
    });

    it('adopted card shows the offer row while the offer is pending, and not after markOfferDone', async () => {
        const before = await list('adopted');
        expect(before.rows.find(r => r.id === 'ado')?.offer).toBe(1);
        // What markOfferDone writes (src/app/actions/applications.ts).
        sqlite.prepare(`UPDATE applications SET offer_done_at = strftime('%s','now') WHERE animal_id = 'ado' AND state = 'closed'`).run();
        const after = await list('adopted');
        expect(after.rows.find(r => r.id === 'ado')?.offer).toBe(0);
        // No other card carries one.
        expect((await list('todos')).rows.filter(r => r.offer > 0)).toEqual([]);
    });

    it('a form whose application row is missing counts after the heal (this page heals)', async () => {
        sqlite.prepare(`INSERT INTO form_submissions (id, user_id, name, selected_animal_id, linked_adopter_id, created_at) VALUES ('f7', ?, 'f7', 'plain', 'p1', 1000)`).run(OWNER);
        const { rows, solicitudes } = await list('solicitudes');
        expect(rows.map(r => r.id).sort()).toEqual(['luna', 'plain', 'tito']);
        expect(rows[0].id).toBe('luna');
        expect(solicitudes).toBe('4');
    });

    it('another team never sees these', async () => {
        state.user = STRANGER;
        const { rows, solicitudes, general } = await list('solicitudes');
        expect(rows.map(r => r.id)).toEqual(['sol']);
        expect([solicitudes, general]).toEqual(['1', '0']);
    });
});
