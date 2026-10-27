import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import { session, getUser, isAdmin, isOrgMate, isOwnerOrOrgMate, OWNER, STRANGER } from '@/test-utils/actionMocks';

const { state, calls } = vi.hoisted(() => ({
    state: { sqlite: null as unknown, db: null as unknown, flag: true, failObservation: false, failAfterInsert: false, discardDuringObservation: false, refuseHousehold: false },
    calls: { saveAdopter: [] as unknown[], append: [] as unknown[], household: [] as unknown[], saveAdoption: [] as unknown[] },
}));
vi.mock('./_db', () => ({ getDb: async () => state.db, getUser }));
vi.mock('@/lib/db', () => ({ getDb: async () => state.db }));
vi.mock('@/config/admins', () => ({ isAdminAsync: isAdmin, isModeratorOrAdminAsync: isAdmin }));
vi.mock('@/lib/orgMembership', () => ({ isOrgMate, isOwnerOrOrgMate }));
vi.mock('@/config/features', () => ({ getFeatureFlag: async () => state.flag }));
vi.mock('./adopters', () => ({
    saveAdopter: vi.fn(async (d: unknown) => { calls.saveAdopter.push(d); return { success: true, id: 'new-1' }; }),
    appendToExistingAdopter: vi.fn(async (id: string, f: unknown) => { calls.append.push([id, f]); return { success: true, adopterId: id }; }),
}));
// Households as profiles (Task 4): the interview's people go through attachHouseholdPeople
// (real, against the real tables), recorded here; `refuseHousehold` makes one person fail.
vi.mock('@/lib/householdPeople', async (orig) => {
    const real = await orig<typeof import('@/lib/householdPeople')>();
    return {
        ...real,
        attachHouseholdPeople: vi.fn(async (...args: Parameters<typeof real.attachHouseholdPeople>) => {
            calls.household.push(args[1]);
            if (state.refuseHousehold) return { householdId: null, created: [], reused: [], skipped: [{ index: 0, reason: 'failed' as const, errorId: 'e1' }] };
            return real.attachHouseholdPeople(...args);
        }),
    };
});
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn(async () => undefined) }));
vi.mock('./adoptions', () => ({
    saveAdoption: vi.fn(async (d: unknown) => {
        if (state.failObservation) throw new Error('D1 down');
        calls.saveAdoption.push(d);
        const dd = d as { id: string; adopterId: string };
        // Another tab discards the draft while this completion is mid-way.
        if (state.discardDuringObservation) (state.sqlite as Sqlite).prepare(`UPDATE interviews SET status = 'discarded' WHERE id = 'i1'`).run();
        if (state.failAfterInsert) {
            state.failAfterInsert = false;
            (state.sqlite as Sqlite).prepare(`INSERT INTO adopter_events (id, adopter_id, event_type) VALUES (?, ?, 'observation')`).run(dd.id, dd.adopterId);
            throw new Error('post-insert failure');
        }
        return { success: true, id: dd.id };
    }),
}));

import { completeInterview } from './interviewComplete';
import { logger } from '@/lib/logger';

type Sqlite = { prepare: (s: string) => { get: (...a: unknown[]) => Record<string, unknown> | undefined; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => Record<string, unknown>[] } };
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
    state.flag = true; state.failObservation = false; state.failAfterInsert = false; state.discardDuringObservation = false; state.refuseHousehold = false;
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
        expect(calls.household).toEqual([expect.objectContaining({
            anchorAdopterId: 'new-1', actor: OWNER, ownerEmail: OWNER, sourceKey: 'interview:i1',
            people: [{ name: 'Ana', relationship: 'partner', index: 0 }],
        })]);
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
        const memberships = () => sqlite.prepare(`SELECT adopter_id, source_key FROM household_memberships ORDER BY added_at, id`).all();
        expect(memberships()).toHaveLength(2); // a-owned + Ana (a profile now)
        state.failObservation = false;
        const r = await completeInterview('i1', { adopterId: 'a-owned', additions: ADD, rating: null, summary: null });
        expect(r.ok).toBe(true);
        expect(memberships()).toHaveLength(2);
        expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM adopters WHERE name = 'Ana' AND deleted_at IS NULL`).get()).toEqual({ n: 1 });
        expect(sqlite.prepare(`SELECT household_members FROM adopters WHERE id = 'a-owned'`).get()).toEqual({ household_members: null });
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

    it('refuses a merged (soft-deleted) candidate before any write', async () => {
        seedDraft();
        sqlite.prepare(`UPDATE adopters SET deleted_at = 2000 WHERE id = 'a-owned'`).run();
        const warn = vi.spyOn(logger, 'warn');
        try {
            expect(await completeInterview('i1', { adopterId: 'a-owned', additions: ADD, rating: 4, summary: 'x' })).toEqual({ ok: false, error: 'invalid' });
            expect(warn).toHaveBeenCalledWith('interviews.complete: target profile is deleted or missing', { interviewId: 'i1', adopterId: 'a-owned' });
        } finally { warn.mockRestore(); }
        expect(calls.saveAdoption).toEqual([]);
        expect(calls.append).toEqual([]);
        expect(calls.household).toEqual([]);
        expect(sqlite.prepare(`SELECT status, adopter_id, event_id FROM interviews WHERE id = 'i1'`).get()).toEqual({ status: 'draft', adopter_id: null, event_id: null });
    });

    it('a candidate merged into another profile mid-interview: saves onto the profile that absorbed it', async () => {
        seedDraft();
        sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, created_at, updated_at, deleted_at, is_demo) VALUES ('a-survivor', 'Juan', '5', ?, 1, 1, NULL, 0)`).run(OWNER);
        sqlite.prepare(`UPDATE adopters SET deleted_at = 2000, token_hash = 'MERGED' WHERE id = 'a-owned'`).run();
        sqlite.prepare(`INSERT INTO audit_log (id, action, target, details, created_at) VALUES ('m1', 'adopter_merge', 'a-survivor', ?, 2000)`)
            .run(JSON.stringify({ primaryId: 'a-survivor', secondaryId: 'a-owned' }));
        const r = await completeInterview('i1', { adopterId: 'a-owned', additions: ADD, rating: 4, summary: 'x' });
        expect(r).toEqual({ ok: true, adopterId: 'a-survivor' });
        expect(calls.saveAdoption[0]).toMatchObject({ recordType: 'observation', adopterId: 'a-survivor' });
        expect(sqlite.prepare(`SELECT status, adopter_id FROM interviews WHERE id = 'i1'`).get()).toEqual({ status: 'completed', adopter_id: 'a-survivor' });
    });

    it('never flips a draft discarded mid-completion to completed', async () => {
        seedDraft();
        state.discardDuringObservation = true;
        const r = await completeInterview('i1', { adopterId: 'a-owned', additions: ADD, rating: null, summary: null });
        expect(r).toEqual({ ok: false, error: 'invalid' });
        expect(sqlite.prepare(`SELECT status FROM interviews WHERE id = 'i1'`).get()).toEqual({ status: 'discarded' });
    });

    it('a refused household add is logged with its error', async () => {
        seedDraft();
        state.refuseHousehold = true;
        const warn = vi.spyOn(logger, 'warn');
        try {
            expect((await completeInterview('i1', { adopterId: 'a-owned', additions: ADD, rating: null, summary: null })).ok).toBe(true);
            expect(warn).toHaveBeenCalledWith('interviews.complete: household people not all added',
                { interviewId: 'i1', adopterId: 'a-owned', failed: 1 });
        } finally { warn.mockRestore(); }
    });
});
