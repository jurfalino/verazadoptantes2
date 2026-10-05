import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import { session, getUser, isAdmin, isOrgMate, isOwnerOrOrgMate, OWNER, STRANGER } from '@/test-utils/actionMocks';

const { state, calls } = vi.hoisted(() => ({
    state: { sqlite: null as unknown, db: null as unknown, flag: true, failObservation: false, failAfterInsert: false },
    calls: { saveAdopter: [] as unknown[], append: [] as unknown[], household: [] as unknown[], saveAdoption: [] as unknown[] },
}));
vi.mock('./_db', () => ({ getDb: async () => state.db, getUser }));
vi.mock('@/config/admins', () => ({ isAdminAsync: isAdmin, isModeratorOrAdminAsync: isAdmin }));
vi.mock('@/lib/orgMembership', () => ({ isOrgMate, isOwnerOrOrgMate }));
vi.mock('@/config/features', () => ({ getFeatureFlag: async () => state.flag }));
vi.mock('./adopters', () => ({
    saveAdopter: vi.fn(async (d: unknown) => { calls.saveAdopter.push(d); return { success: true, id: 'new-1' }; }),
    appendToExistingAdopter: vi.fn(async (id: string, f: unknown) => { calls.append.push([id, f]); return { success: true, adopterId: id }; }),
}));
vi.mock('./householdMembers', () => ({
    addHouseholdMember: vi.fn(async (i: unknown) => { calls.household.push(i); return { ok: true, memberId: 'm1' }; }),
}));
vi.mock('./adoptions', () => ({
    saveAdoption: vi.fn(async (d: unknown) => {
        if (state.failObservation) throw new Error('D1 down');
        calls.saveAdoption.push(d);
        const dd = d as { id: string; adopterId: string };
        if (state.failAfterInsert) {
            state.failAfterInsert = false;
            (state.sqlite as Sqlite).prepare(`INSERT INTO adopter_events (id, adopter_id, event_type) VALUES (?, ?, 'observation')`).run(dd.id, dd.adopterId);
            throw new Error('post-insert failure');
        }
        return { success: true, id: dd.id };
    }),
}));

import { completeInterview } from './interviewComplete';

type Sqlite = { prepare: (s: string) => { get: (...a: unknown[]) => Record<string, unknown> | undefined; run: (...a: unknown[]) => unknown } };
let sqlite: Sqlite;

function seedDraft(over: { candidateIds?: string[]; answers?: unknown; prep?: unknown; conductedBy?: string } = {}) {
    sqlite.prepare(`INSERT INTO interviews (id, conducted_by, status, source_kind, prep_json, answers_json, candidate_ids_json)
        VALUES ('i1', ?, 'draft', 'standalone', ?, ?, ?)`).run(
        over.conductedBy ?? OWNER,
        JSON.stringify({ prep: over.prep ?? { name: 'Juan Pérez', phones: ['1165851333'], emails: [], socials: [], address: '' }, leadCandidateId: null, confirmedAdopterId: null }),
        JSON.stringify({ answers: over.answers ?? {
            story_household: { status: 'answered', household: [{ name: 'Ana', relationship: 'partner' }] },
            details_email: { status: 'answered', contacts: [{ type: 'email', value: 'juan@x.com' }] },
        }, visited: ['story_household', 'details_email'], custom: [] }),
        JSON.stringify(over.candidateIds ?? ['a-owned', 'a-foreign']),
    );
}
const ADD = {
    contacts: [{ type: 'phone' as const, value: '1165851333' }, { type: 'email' as const, value: 'juan@x.com' }],
    address: null, household: [{ name: 'Ana', relationship: 'partner' as const }],
};

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db; state.sqlite = m.sqlite; sqlite = m.sqlite as unknown as Sqlite;
    state.flag = true; state.failObservation = false; state.failAfterInsert = false;
    for (const k of Object.keys(calls) as (keyof typeof calls)[]) calls[k] = [];
    session.user = OWNER;
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at, deleted_at, is_demo) VALUES ('a-owned', 'Juan', '5', ?, 1, 1, NULL, 0)`).run(OWNER);
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at, deleted_at, is_demo) VALUES ('a-foreign', 'Juan', '5', ?, 1, 1, NULL, 0)`).run(STRANGER);
});

describe('completeInterview', () => {
    it('new person: creates the profile with collected contacts, adds household, writes the observation, completes', async () => {
        seedDraft();
        const r = await completeInterview('i1', { adopterId: 'new', additions: ADD, rating: 4, summary: 'Buena predisposición' });
        expect(r).toEqual({ ok: true, adopterId: 'new-1' });
        expect(JSON.parse((calls.saveAdopter[0] as { contactEntries: string }).contactEntries).map((e: { type: string }) => e.type).sort()).toEqual(['email', 'phone']);
        expect(calls.household).toEqual([{ adopterId: 'new-1', name: 'Ana', relationship: 'partner' }]);
        expect(calls.saveAdoption[0]).toMatchObject({ recordType: 'observation', adopterId: 'new-1', rating: 4, details: 'Buena predisposición' });
        const row = sqlite.prepare(`SELECT status, adopter_id, event_id FROM interviews WHERE id = 'i1'`).get()!;
        expect(row).toEqual({ status: 'completed', adopter_id: 'new-1', event_id: 'i1-obs' });
    });

    it('a retry after a failed observation does not create a second profile', async () => {
        seedDraft();
        state.failObservation = true;
        const first = await completeInterview('i1', { adopterId: 'new', additions: ADD, rating: null, summary: null });
        expect(first.ok).toBe(false);
        expect(sqlite.prepare(`SELECT status, adopter_id FROM interviews WHERE id = 'i1'`).get()).toEqual({ status: 'draft', adopter_id: 'new-1' });
        state.failObservation = false;
        const second = await completeInterview('i1', { adopterId: 'new', additions: ADD, rating: null, summary: null });
        expect(second).toEqual({ ok: true, adopterId: 'new-1' });
        expect(calls.saveAdopter).toHaveLength(1);
    });

    it('completing twice is idempotent', async () => {
        seedDraft();
        await completeInterview('i1', { adopterId: 'a-owned', additions: ADD, rating: null, summary: null });
        const again = await completeInterview('i1', { adopterId: 'a-owned', additions: ADD, rating: null, summary: null });
        expect(again).toEqual({ ok: true, adopterId: 'a-owned' });
        expect(calls.saveAdoption).toHaveLength(1);
    });

    it('my own candidate: additions are appended; skipped rating is stored as null', async () => {
        seedDraft();
        await completeInterview('i1', { adopterId: 'a-owned', additions: ADD, rating: null, summary: null });
        expect(calls.append[0]).toEqual(['a-owned', expect.objectContaining({ contactEntries: expect.any(String) })]);
        expect(calls.saveAdoption[0]).toMatchObject({ rating: null, details: null });
    });

    it("someone else's profile: nothing is added to it, the observation still lands", async () => {
        seedDraft();
        const r = await completeInterview('i1', { adopterId: 'a-foreign', additions: ADD, rating: 3, summary: null });
        expect(r.ok).toBe(true);
        expect(calls.append).toEqual([]);
        expect(calls.household).toEqual([]);
        expect(calls.saveAdoption).toHaveLength(1);
    });

    it('refuses a target that is not one of the interview candidates', async () => {
        seedDraft({ candidateIds: ['a-owned'] });
        expect(await completeInterview('i1', { adopterId: 'a-foreign', additions: ADD, rating: null, summary: null })).toEqual({ ok: false, error: 'forbidden' });
        expect(calls.saveAdoption).toEqual([]);
    });

    it('drops additions the interview never collected', async () => {
        seedDraft();
        await completeInterview('i1', { adopterId: 'a-owned', additions: { ...ADD, contacts: [{ type: 'phone', value: '1199998888' }] }, rating: null, summary: null });
        expect(calls.append).toEqual([]);
    });

    it("another rescuer cannot complete my interview", async () => {
        seedDraft();
        session.user = STRANGER;
        expect(await completeInterview('i1', { adopterId: 'new', additions: ADD, rating: null, summary: null })).toEqual({ ok: false, error: 'forbidden' });
    });

    it('a retry after the observation row landed but the call threw writes exactly one observation', async () => {
        seedDraft();
        state.failAfterInsert = true;
        const first = await completeInterview('i1', { adopterId: 'a-owned', additions: ADD, rating: null, summary: null });
        expect(first.ok).toBe(false);
        const second = await completeInterview('i1', { adopterId: 'a-owned', additions: ADD, rating: null, summary: null });
        expect(second).toEqual({ ok: true, adopterId: 'a-owned' });
        expect(calls.saveAdoption).toHaveLength(1);
        expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM adopter_events WHERE id = 'i1-obs'`).get()).toEqual({ n: 1 });
        expect(sqlite.prepare(`SELECT status, event_id FROM interviews WHERE id = 'i1'`).get()).toEqual({ status: 'completed', event_id: 'i1-obs' });
    });

    it('a retry does not add household members already on the profile', async () => {
        seedDraft();
        state.failObservation = true;
        await completeInterview('i1', { adopterId: 'a-owned', additions: ADD, rating: null, summary: null });
        expect(calls.household).toHaveLength(1);
        // Simulate the real append the mock skipped.
        sqlite.prepare(`UPDATE adopters SET household_members = ? WHERE id = 'a-owned'`).run(JSON.stringify([{ id: 'm1', name: 'ANA ', relationship: 'partner', contactEntries: [] }]));
        state.failObservation = false;
        const r = await completeInterview('i1', { adopterId: 'a-owned', additions: ADD, rating: null, summary: null });
        expect(r.ok).toBe(true);
        expect(calls.household).toHaveLength(1);
    });

    it('a retry that names a different candidate than the one already chosen is refused before any write', async () => {
        seedDraft({ candidateIds: ['a-owned', 'a-foreign'] });
        state.failObservation = true;
        await completeInterview('i1', { adopterId: 'a-owned', additions: ADD, rating: null, summary: null });
        state.failObservation = false;
        const appends = calls.append.length;
        expect(await completeInterview('i1', { adopterId: 'a-foreign', additions: ADD, rating: null, summary: null })).toEqual({ ok: false, error: 'invalid' });
        expect(calls.append).toHaveLength(appends);
        expect(calls.saveAdoption).toEqual([]);
    });
});
