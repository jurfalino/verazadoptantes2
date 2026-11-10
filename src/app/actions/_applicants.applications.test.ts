/**
 * Applicants are applications: the list reads `applications` joined to their form,
 * through the owner's team; the status comes from the application + its contract links.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown } }));
vi.mock('@/app/actions/_db', () => ({ getDb: async () => state.db, getUser: async () => 'owner@example.com' }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/lib/logger', async (orig) => ({ ...(await orig<typeof import('@/lib/logger')>()), logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(() => 'err12345') } }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/requestContext', () => ({ getRequestContext: () => ({ env: {} }) }));

import { loadApplicantsForAnimal, loadGeneralApplications, listApplicantIdsForAnimal } from './_applicants';

type Sqlite = { prepare: (s: string) => { run: (...a: unknown[]) => unknown } };
let sqlite: Sqlite;

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

const OWNER = 'owner@example.com';
const MATE = 'mate@example.com';
const OUTSIDER = 'outsider@example.com';
const DAY = 86_400;
const NOW = Math.floor(Date.now() / 1000);

function form(id: string, userId: string, adopter: string | null, selectedAnimal: string | null, createdAt: number) {
    sqlite.prepare(`INSERT INTO form_submissions (id, user_id, name, selected_animal_id, linked_adopter_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(id, userId, id, selectedAnimal, adopter, createdAt);
}
function app(id: string, submission: string, animal: string | null, o: { origin?: string; state?: string; closeReason?: string | null; closedAt?: number | null; asked?: string | null; proposed?: string | null; replacedBy?: string | null } = {}) {
    sqlite.prepare(`INSERT INTO applications (id, submission_id, animal_id, origin, state, close_reason, closed_at, asked_animal_id, proposed_application_id, replaced_by_application_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, submission, animal, o.origin ?? 'form', o.state ?? 'open', o.closeReason ?? null, o.closedAt ?? null, o.asked ?? null, o.proposed ?? null, o.replacedBy ?? null);
}
function invite(token: string, adopter: string, createdAt: number, expiresAt: number | null, usedAt: number | null = null) {
    sqlite.prepare(`INSERT INTO contract_invitations (token, animal_id, adopter_id, created_by, created_at, expires_at, used_at) VALUES (?, 'luna', ?, ?, ?, ?, ?)`)
        .run(token, adopter, OWNER, createdAt, expiresAt, usedAt);
}

beforeEach(() => {
    const m = migratedDb();
    state.db = asyncDb(m.db);
    sqlite = m.sqlite as unknown as Sqlite;
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by) VALUES ('ana', 'Ana', '5', ?), ('beto', 'Beto', '5', ?), ('cami', 'Cami', '5', ?)`).run(OWNER, OWNER, OWNER);
    sqlite.prepare(`INSERT INTO animals (id, name, species, added_by, created_at, updated_at) VALUES ('luna', 'Luna', 'cat', ?, 1000, 1000)`).run(OWNER);
});

const load = () => loadApplicantsForAnimal(state.db, { id: 'luna', adopterId: null }, [OWNER, MATE], OWNER);

describe('applicants are applications', () => {
    it('lists the animal\'s applications through the owner\'s team — a forged outsider row and a «replaced» row never show', async () => {
        form('s-ana', OWNER, 'ana', 'luna', NOW - 3 * DAY); app('app-s-ana', 's-ana', 'luna');
        form('s-beto', MATE, 'beto', 'luna', NOW - 2 * DAY); app('app-s-beto', 's-beto', 'luna');
        form('s-forged', OUTSIDER, 'cami', 'luna', NOW - DAY); app('app-s-forged', 's-forged', 'luna');
        form('s-old', OWNER, 'ana', 'luna', NOW - 9 * DAY); app('app-s-old', 's-old', 'luna', { state: 'replaced' });
        const list = await load();
        expect(list.map(a => a.applicationId)).toEqual(['app-s-ana', 'app-s-beto']);
        const ids = await listApplicantIdsForAnimal(state.db, 'luna', [OWNER, MATE]);
        expect(ids).toEqual(expect.arrayContaining([
            { submissionId: 's-ana', applicationId: 'app-s-ana' }, { submissionId: 's-beto', applicationId: 'app-s-beto' },
        ]));
        expect(ids).toHaveLength(2);
    });

    it('a proposed application (origin proposed, submission has selected_animal_id NULL) is a candidate of the animal', async () => {
        form('s-ana', OWNER, 'ana', null, NOW - DAY); app('app-prop', 's-ana', 'luna', { origin: 'proposed' });
        const list = await load();
        expect(list).toHaveLength(1);
        expect(list[0]).toMatchObject({ applicationId: 'app-prop', origin: 'proposed', adopterId: 'ana' });
    });

    it('status: live link → contract_sent and hasInvite; a retired link → to_evaluate with note replaced, hasInvite false', async () => {
        form('s-ana', OWNER, 'ana', 'luna', NOW - 5 * DAY); app('app-s-ana', 's-ana', 'luna');
        form('s-beto', OWNER, 'beto', 'luna', NOW - 4 * DAY); app('app-s-beto', 's-beto', 'luna');
        invite('t-ana', 'ana', NOW - DAY, NOW + 29 * DAY);
        // Beto's link was retired a day after it was made (well before its 30 days).
        invite('t-beto', 'beto', NOW - 3 * DAY, NOW - 2 * DAY);
        const list = await load();
        const ana = list.find(a => a.adopterId === 'ana')!;
        const beto = list.find(a => a.adopterId === 'beto')!;
        expect(ana.status).toMatchObject({ kind: 'contract_sent' });
        expect(ana.hasInvite).toBe(true);
        expect(beto.status).toMatchObject({ kind: 'to_evaluate', note: { kind: 'replaced' } });
        expect(beto.hasInvite).toBe(false);
    });

    it('an adopted application is «Firmado»; a foster holder\'s own open application is not', async () => {
        form('s-ana', OWNER, 'ana', 'luna', NOW - 5 * DAY); app('app-s-ana', 's-ana', 'luna', { state: 'adopted' });
        form('s-beto', OWNER, 'beto', 'luna', NOW - 4 * DAY); app('app-s-beto', 's-beto', 'luna');
        const list = await loadApplicantsForAnimal(state.db, { id: 'luna', adopterId: 'beto' }, [OWNER], OWNER);
        expect(list.find(a => a.adopterId === 'ana')!.isSigned).toBe(true);
        expect(list.find(a => a.adopterId === 'beto')!.isSigned).toBe(false);
    });

    it('order: por evaluar oldest first, then contract sent, then outcomes', async () => {
        form('s-new', OWNER, 'ana', 'luna', NOW - 1 * DAY); app('app-new', 's-new', 'luna');
        form('s-old', OWNER, 'beto', 'luna', NOW - 6 * DAY); app('app-old', 's-old', 'luna');
        form('s-sent', OWNER, 'cami', 'luna', NOW - 7 * DAY); app('app-sent', 's-sent', 'luna');
        invite('t-sent', 'cami', NOW - DAY, NOW + 29 * DAY);
        form('s-dec', OWNER, 'ana', 'luna', NOW - 8 * DAY); app('app-dec', 's-dec', 'luna', { state: 'declined', closedAt: NOW - DAY });
        expect((await load()).map(a => a.applicationId)).toEqual(['app-old', 'app-new', 'app-sent', 'app-dec']);
    });

    it('loadGeneralApplications: animal_id NULL rows of the viewer\'s team; askedAnimal named only for the team\'s own animal (forged other-team animal → null)', async () => {
        sqlite.prepare(`INSERT INTO animals (id, name, sex, added_by, created_at, updated_at) VALUES ('adopted-own', 'Mora', 'hembra', ?, 1000, 1000), ('adopted-other', 'Ajena', 'macho', ?, 1000, 1000)`)
            .run(OWNER, OUTSIDER);
        form('s-gen', OWNER, 'ana', null, NOW - 3 * DAY); app('app-gen', 's-gen', null);
        form('s-own', MATE, 'beto', 'adopted-own', NOW - 2 * DAY); app('app-own', 's-own', null, { origin: 'adopted_animal', asked: 'adopted-own' });
        form('s-forged', OWNER, 'cami', 'adopted-other', NOW - DAY); app('app-forged', 's-forged', null, { origin: 'adopted_animal', asked: 'adopted-other' });
        form('s-out', OUTSIDER, 'ana', null, NOW - DAY); app('app-out', 's-out', null);
        form('s-anim', OWNER, 'ana', 'luna', NOW - DAY); app('app-anim', 's-anim', 'luna');
        const list = await loadGeneralApplications(state.db, [OWNER, MATE], OWNER);
        expect(list.map(a => a.applicationId)).toEqual(['app-gen', 'app-own', 'app-forged']);
        expect(list.find(a => a.applicationId === 'app-own')!.askedAnimal).toEqual({ id: 'adopted-own', name: 'Mora', sex: 'hembra' });
        expect(list.find(a => a.applicationId === 'app-forged')!.askedAnimal).toBeNull();
        expect(list.find(a => a.applicationId === 'app-gen')!.askedAnimal).toBeNull();
    });

    it('«Propuesta para …» / «También pidió a …»: the general application names the animal it led to — only the team\'s own animal', async () => {
        sqlite.prepare(`INSERT INTO animals (id, name, sex, added_by, created_at, updated_at) VALUES ('mora', 'Mora', 'hembra', ?, 1000, 1000), ('ajena', 'Ajena', 'macho', ?, 1000, 1000)`)
            .run(OWNER, OUTSIDER);
        form('s-prop', OWNER, 'ana', null, NOW - 3 * DAY);
        app('app-to-mora', 's-prop', 'mora', { origin: 'proposed' });
        app('app-prop', 's-prop', null, { state: 'proposed', proposed: 'app-to-mora', closedAt: NOW - DAY });
        form('s-also', OWNER, 'beto', null, NOW - 2 * DAY);
        form('s-beto-luna', OWNER, 'beto', 'luna', NOW - DAY); app('app-beto-luna', 's-beto-luna', 'luna');
        app('app-also', 's-also', null, { state: 'also_applied', replacedBy: 'app-beto-luna' });
        form('s-ajena', OWNER, 'cami', null, NOW - 2 * DAY);
        form('s-cami-ajena', OUTSIDER, 'cami', 'ajena', NOW - DAY); app('app-cami-ajena', 's-cami-ajena', 'ajena');
        app('app-also-ajena', 's-ajena', null, { state: 'also_applied', replacedBy: 'app-cami-ajena' });
        form('s-gen', OWNER, 'ana', null, NOW - DAY); app('app-gen', 's-gen', null);
        const list = await loadGeneralApplications(state.db, [OWNER, MATE], OWNER);
        const by = (id: string) => list.find(a => a.applicationId === id)!;
        expect(by('app-prop').outcomeAnimal).toEqual({ id: 'mora', name: 'Mora', sex: 'hembra' });
        expect(by('app-also').outcomeAnimal).toEqual({ id: 'luna', name: 'Luna', sex: null });
        expect(by('app-also-ajena').outcomeAnimal).toBeNull();
        expect(by('app-gen').outcomeAnimal).toBeNull();
    });
});
