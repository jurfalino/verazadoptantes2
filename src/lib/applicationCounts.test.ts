/**
 * The counts equal the animal page's to-do list (Review Focus 2): same scope,
 * same status rule, on one edge fixture — and each issues ONE grouped select.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown, req: {} as Headers } }));
vi.mock('@/app/actions/_db', () => ({ getDb: async () => state.db, getUser: async () => 'owner@example.com' }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/lib/logger', async (orig) => ({ ...(await orig<typeof import('@/lib/logger')>()), logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') } }));
vi.mock('next/headers', () => ({ headers: async () => state.req })); // one object per test = one request
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
    const calls = { select: 0, run: 0 };
    const proxy = new Proxy(db as object, {
        get(t, p, r) {
            const v = Reflect.get(t, p, r);
            if (p === 'select') return (...a: unknown[]) => { calls.select++; return (v as (...x: unknown[]) => unknown).apply(t, a); };
            if (p === 'run') return (...a: unknown[]) => { calls.run++; return (v as (...x: unknown[]) => unknown).apply(t, a); };
            return typeof v === 'function' ? (v as (...x: unknown[]) => unknown).bind(t) : v;
        },
    });
    return { db: proxy, calls };
}

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    state.req = new Headers();
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

    it("an animal the team does not own never gets a key (forged ?animal= through the team's link)", async () => {
        const m = await countToEvaluateByAnimal(state.db, [OWNER, MATE], NOW);
        expect([...m.keys()]).toEqual(['luna']);
        expect([...(await countOpenByAnimal(state.db, [OWNER, MATE])).keys()]).toEqual(['luna']);
        form('c9', OWNER, 'a7', 'brisa'); app('c9', 'brisa', { state: 'closed', closeReason: 'adopted_other' });
        expect((await offerCountsByAnimal(state.db, [OWNER, MATE])).has('brisa')).toBe(false);
    });

    it('two counts in one request heal the team once', async () => {
        const { db, calls } = spied(state.db);
        await countToEvaluateByAnimal(db, [OWNER, MATE], NOW);
        await countOpenByAnimal(db, [MATE, OWNER.toUpperCase()]);
        await toEvaluateAdopterIds(db, [OWNER, MATE], NOW);
        expect(calls.run).toBe(1);
    });

    it('toEvaluateAdopterIds with { heal: false } writes nothing (the home feed); by default it heals (final review I4)', async () => {
        const quiet = spied(state.db);
        await toEvaluateAdopterIds(quiet.db, [OWNER, MATE], NOW, { heal: false });
        expect(quiet.calls.run).toBe(0);
        state.req = new Headers(); // a new request: the memo starts over
        const healing = spied(state.db);
        await toEvaluateAdopterIds(healing.db, [OWNER, MATE], NOW);
        expect(healing.calls.run).toBe(1);
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
        expect([...ids].sort()).toEqual(['a1', 'a3', 'a4', 'a9']);
        expect(ids.has('z2')).toBe(false); // OWNER's link onto ZOE's animal: not the owner's team's to evaluate
        expect(ids.has('a2')).toBe(false); // live link: «Contrato enviado» is an outcome
        expect(ids.has('a5')).toBe(false); // expires_at NULL = live
        expect(ids.has('a8')).toBe(false); // declined
    });
});

describe('I1 — an application nobody can finish defers no pair (Q6)', () => {
    it('a soft-deleted animal: its open applications leave toEvaluateAdopterIds and every count', async () => {
        // Set directly (an old build, a failed close): the SQL filter must hold on its own.
        sqlite.prepare(`UPDATE animals SET deleted_at = ? WHERE id = 'luna'`).run(NOW);
        expect([...(await toEvaluateAdopterIds(state.db, [OWNER, MATE], NOW))].sort()).toEqual(['a1']); // a1's general application stays
        expect((await countToEvaluateByAnimal(state.db, teamOf('luna'), NOW)).has('luna')).toBe(false);
        expect((await countOpenByAnimal(state.db, teamOf('luna'))).has('luna')).toBe(false);
    });

    it('an adopted animal whose close did not land: its open applications leave toEvaluateAdopterIds (takesContract in SQL)', async () => {
        sqlite.prepare(`INSERT INTO placements (id, animal_id, adopter_id, record_type, started_at, created_at) VALUES ('p-luna', 'luna', 'a2', 'adoption', 1000, 1000)`).run();
        expect([...(await toEvaluateAdopterIds(state.db, [OWNER, MATE], NOW))].sort()).toEqual(['a1']);
    });

    it('a fostered animal still takes a contract: its applicants stay to evaluate', async () => {
        sqlite.prepare(`INSERT INTO placements (id, animal_id, adopter_id, record_type, started_at, created_at) VALUES ('p-luna', 'luna', 'a2', 'foster', 1000, 1000)`).run();
        expect([...(await toEvaluateAdopterIds(state.db, [OWNER, MATE], NOW))].sort()).toEqual(['a1', 'a3', 'a4', 'a9']);
    });

    it('softDeleteAnimal closes the animal\'s open applications (animal_deleted), leaving decided ones as they are', async () => {
        const { softDeleteAnimal } = await import('@/app/actions/_recordWrite');
        expect(await softDeleteAnimal(state.db, 'luna', OWNER)).toBe(true);
        const rows = (sqlite as unknown as { prepare: (s: string) => { all: () => Array<{ id: string; state: string; close_reason: string | null; closed_by: string | null; closed_at: number | null }> } })
            .prepare(`SELECT id, state, close_reason, closed_by, closed_at FROM applications WHERE animal_id = 'luna' ORDER BY id`).all();
        const by = new Map(rows.map(r => [r.id, r]));
        for (const id of ['app-f1', 'app-f2', 'app-f3', 'app-f4', 'app-f5', 'app-f6', 'app-f7', 'app-f10']) {
            expect(by.get(id), id).toMatchObject({ state: 'closed', close_reason: 'animal_deleted', closed_by: OWNER });
            expect(by.get(id)!.closed_at).toEqual(expect.any(Number));
        }
        expect(by.get('app-f8')).toMatchObject({ state: 'replaced', close_reason: null });
        expect(by.get('app-f9')).toMatchObject({ state: 'declined', close_reason: null });
        // Brisa (another animal) is untouched; no offer is spawned by a delete.
        expect((sqlite as unknown as { prepare: (s: string) => { get: () => { state: string } } }).prepare(`SELECT state FROM applications WHERE id = 'app-g1'`).get().state).toBe('open');
        sqlite.prepare(`UPDATE animals SET deleted_at = NULL WHERE id = 'luna'`).run(); // even restored, nothing is an offer
        expect((await offerCountsByAnimal(state.db, teamOf('luna'))).has('luna')).toBe(false);
    });
});

describe('I2 — an application on a deleted profile is no to-do (home = tab = panel)', () => {
    it('a soft-deleted (or missing) applicant profile counts nowhere, and the panel agrees', async () => {
        for (const id of ['d1', 'd2']) sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, deleted_at) VALUES (?, ?, '5', ?, ?)`).run(id, id, OWNER, NOW);
        form('fd1', OWNER, 'd1', 'luna'); app('fd1', 'luna');   // soft-deleted profile (admin «Papelera»)
        form('fd2', OWNER, 'gone', 'luna'); app('fd2', 'luna'); // dangling id: the profile row is gone
        form('hd1', MATE, 'd2', null); app('hd1', null);        // a general one on a soft-deleted profile
        const listed = (await loadApplicantsForAnimal(state.db, { id: 'luna', adopterId: null }, teamOf('luna'), OWNER)).filter(isToDo);
        expect(listed.map(a => a.submissionId)).not.toContain('fd1');
        expect(listed.map(a => a.submissionId)).not.toContain('fd2');
        expect(listed).toHaveLength(4);
        expect((await countToEvaluateByAnimal(state.db, teamOf('luna'), NOW)).get('luna')).toBe(4);
        expect(await countGeneralToEvaluate(state.db, [OWNER, MATE])).toBe(1);
        const ids = await toEvaluateAdopterIds(state.db, [OWNER, MATE], NOW);
        for (const id of ['d1', 'd2', 'gone']) expect(ids.has(id), id).toBe(false);
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
