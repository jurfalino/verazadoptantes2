/**
 * The counts equal the animal page's to-do list (Review Focus 2): same scope,
 * same status rule, on one edge fixture — and each issues ONE grouped select.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));
vi.mock('@/app/actions/_db', () => ({ getDb: async () => state.db, getUser: async () => 'owner@example.com' }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/lib/logger', async (orig) => ({ ...(await orig<typeof import('@/lib/logger')>()), logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') } }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/requestContext', () => ({ getRequestContext: () => ({ env: {} }) }));

import { loadApplicantsForAnimal } from '@/app/actions/_applicants';
import { isToDo } from '@/domain/applications';
import { countToEvaluateByAnimal, countOpenByAnimal, countGeneralToEvaluate, toEvaluateAdopterIds, offerCountsByAnimal } from './applicationCounts';

type Sqlite = { prepare: (s: string) => { run: (...a: unknown[]) => unknown } };
let sqlite: Sqlite;

const OWNER = 'owner@example.com';
const MATE = 'mate@example.com';
const OUTSIDER = 'outsider@example.com';
const ZOE = 'zoe@example.com';
const DAY = 86_400;
const NOW = Math.floor(Date.now() / 1000);
const teamOf = (animal: string) => (animal === 'luna' ? [OWNER, MATE] : [ZOE]);

function form(id: string, userId: string, adopter: string | null, animal: string | null) {
    sqlite.prepare(`INSERT INTO form_submissions (id, user_id, name, selected_animal_id, linked_adopter_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(id, userId, id, animal, adopter, NOW - 5 * DAY);
}
function app(id: string, animal: string | null, o: { state?: string; closeReason?: string | null; offerDoneAt?: number | null } = {}) {
    sqlite.prepare(`INSERT INTO applications (id, submission_id, animal_id, origin, state, close_reason, offer_done_at) VALUES (?, ?, ?, 'form', ?, ?, ?)`)
        .run(`app-${id}`, id, animal, o.state ?? 'open', o.closeReason ?? null, o.offerDoneAt ?? null);
}
function invite(token: string, animal: string, adopter: string, expiresAt: number | null, usedAt: number | null = null) {
    sqlite.prepare(`INSERT INTO contract_invitations (token, animal_id, adopter_id, created_by, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(token, animal, adopter, OWNER, NOW - 2 * DAY, expiresAt, usedAt);
}

/** Counts db.select calls (the counts must each issue exactly one). */
function spied(db: unknown) {
    const calls = { select: 0 };
    const proxy = new Proxy(db as object, {
        get(t, p, r) {
            const v = Reflect.get(t, p, r);
            if (p === 'select') return (...a: unknown[]) => { calls.select++; return (v as (...x: unknown[]) => unknown).apply(t, a); };
            return typeof v === 'function' ? (v as (...x: unknown[]) => unknown).bind(t) : v;
        },
    });
    return { db: proxy, calls };
}

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as Sqlite;
    for (const id of ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'z1', 'z2']) {
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by) VALUES (?, ?, '5', ?)`).run(id, id, OWNER);
    }
    sqlite.prepare(`INSERT INTO animals (id, name, species, added_by, created_at, updated_at) VALUES ('luna', 'Luna', 'cat', ?, 1000, 1000), ('brisa', 'Brisa', 'cat', ?, 1000, 1000)`).run(OWNER, ZOE);
    // Luna (owner team O+M)
    form('f1', OWNER, 'a1', 'luna'); app('f1', 'luna');                       // no link → to evaluate
    form('f2', MATE, 'a2', 'luna'); app('f2', 'luna'); invite('t2', 'luna', 'a2', NOW + 20 * DAY); // live link
    form('f3', MATE, 'a3', 'luna'); app('f3', 'luna'); invite('t3', 'luna', 'a3', NOW - DAY);       // retired link → to evaluate
    form('f4', OWNER, 'a4', 'luna'); app('f4', 'luna'); invite('t4', 'luna', 'a4', NOW - 3600);     // expired → to evaluate
    form('f5', OWNER, 'a5', 'luna'); app('f5', 'luna'); invite('t5', 'luna', 'a5', null);           // expires_at NULL = live
    form('f6', OUTSIDER, 'a6', 'luna'); app('f6', 'luna');                    // forged outsider
    form('f7', OWNER, null, 'luna'); app('f7', 'luna');                       // orphan form (no profile)
    form('f8', OWNER, 'a7', 'luna'); app('f8', 'luna', { state: 'replaced' });
    form('f9', OWNER, 'a8', 'luna'); app('f9', 'luna', { state: 'declined' });
    form('f10', OWNER, 'a9', 'luna'); app('f10', 'luna'); invite('t10', 'luna', 'a9', NOW + DAY, NOW - 100); // used link: unused-and-live is what counts → to evaluate
    // Brisa (another org); its applicant came through ZOE's group, plus a row through the OWNER's link (forged for brisa)
    form('g1', ZOE, 'z1', 'brisa'); app('g1', 'brisa');
    form('g2', OWNER, 'z2', 'brisa'); app('g2', 'brisa');
    // General (no animal)
    form('h1', OWNER, 'a1', null); app('h1', null);
    form('h2', MATE, null, null); app('h2', null);
});

describe('countToEvaluateByAnimal', () => {
    it('equals loadApplicantsForAnimal().filter(isToDo) on the edge fixture', async () => {
        for (const animal of ['luna', 'brisa']) {
            const listed = (await loadApplicantsForAnimal(state.db, { id: animal, adopterId: null }, teamOf(animal), OWNER)).filter(isToDo).length;
            expect((await countToEvaluateByAnimal(state.db, teamOf(animal), NOW)).get(animal) ?? 0).toBe(listed);
        }
        expect((await countToEvaluateByAnimal(state.db, teamOf('luna'), NOW)).get('luna')).toBe(4); // f1, f3, f4, f10
        expect((await countToEvaluateByAnimal(state.db, teamOf('brisa'), NOW)).get('brisa')).toBe(1);
    });

    it('binds no arrays and issues one select per call', async () => {
        for (const run of [
            (d: unknown) => countToEvaluateByAnimal(d, [OWNER, MATE], NOW),
            (d: unknown) => countOpenByAnimal(d, [OWNER, MATE]),
            (d: unknown) => countGeneralToEvaluate(d, [OWNER, MATE]),
            (d: unknown) => toEvaluateAdopterIds(d, [OWNER, MATE], NOW),
            (d: unknown) => offerCountsByAnimal(d, [OWNER, MATE]),
        ]) {
            const { db, calls } = spied(state.db);
            await run(db);
            expect(calls.select).toBe(1);
        }
    });

    it('fails closed on an empty team', async () => {
        expect((await countToEvaluateByAnimal(state.db, [], NOW)).size).toBe(0);
        expect(await countGeneralToEvaluate(state.db, [])).toBe(0);
        expect((await toEvaluateAdopterIds(state.db, [], NOW)).size).toBe(0);
    });

    it('a form whose application row is missing is healed and counted', async () => {
        form('f11', OWNER, 'a7', 'luna'); // no application row
        expect((await countToEvaluateByAnimal(state.db, teamOf('luna'), NOW)).get('luna')).toBe(5);
    });
});

describe('countOpenByAnimal', () => {
    it('counts to-evaluate AND contract-sent (and an orphan form), not replaced / declined / outsider', async () => {
        const open = await countOpenByAnimal(state.db, teamOf('luna'));
        expect(open.get('luna')).toBe(7); // f1 f2 f3 f4 f5 f7 f10
    });
});

describe('countGeneralToEvaluate', () => {
    it('counts open general applications on a profile (the orphan is no to-do)', async () => {
        expect(await countGeneralToEvaluate(state.db, [OWNER, MATE])).toBe(1);
    });
});

describe('toEvaluateAdopterIds', () => {
    it('lists to-evaluate profiles of the team (animal + general); a live link, a decline and an outsider are out', async () => {
        const ids = await toEvaluateAdopterIds(state.db, [OWNER, MATE], NOW);
        expect([...ids].sort()).toEqual(['a1', 'a3', 'a4', 'a9', 'z2']);
        expect(ids.has('a2')).toBe(false); // live link: «Contrato enviado» is an outcome
        expect(ids.has('a5')).toBe(false); // expires_at NULL = live
        expect(ids.has('a8')).toBe(false); // declined
    });
});

describe('offerCountsByAnimal', () => {
    it('counts candidates closed by another adoption whose offer is not done', async () => {
        form('c1', OWNER, 'a7', 'luna'); app('c1', 'luna', { state: 'closed', closeReason: 'adopted_other' });
        form('c2', OWNER, 'a8', 'luna'); app('c2', 'luna', { state: 'closed', closeReason: 'adopted_other', offerDoneAt: NOW });
        form('c3', OWNER, 'a6', 'luna'); app('c3', 'luna', { state: 'closed', closeReason: 'adopted_open_link' });
        expect((await offerCountsByAnimal(state.db, teamOf('luna'))).get('luna')).toBe(1);
    });
});
