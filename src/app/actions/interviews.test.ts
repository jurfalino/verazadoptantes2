import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migratedDb } from '@/test-utils/migratedDb';
import { session, getUser, isAdmin, isOrgMate, isOwnerOrOrgMate, OWNER, MATE, STRANGER } from '@/test-utils/actionMocks';
import type { CandidateSummary } from '@/domain/interview/types';

const { state } = vi.hoisted(() => ({ state: { db: null as unknown, flag: true, matches: [] as CandidateSummary[] } }));
vi.mock('./_db', () => ({ getDb: async () => state.db, getUser }));
vi.mock('@/config/admins', () => ({ isAdminAsync: isAdmin, isModeratorOrAdminAsync: isAdmin }));
vi.mock('@/lib/orgMembership', () => ({ isOrgMate, isOwnerOrOrgMate }));
vi.mock('@/config/features', () => ({ getFeatureFlag: async () => state.flag }));
vi.mock('@/app/actions/userNames', () => ({ resolveUserNames: async (emails: string[]) => Object.fromEntries(emails.map(e => [e, e.split('@')[0]])) }));
vi.mock('@/lib/interviews/store', async (orig) => {
    const real = await orig<typeof import('@/lib/interviews/store')>();
    return {
        ...real,
        matchCandidates: vi.fn(async () => state.matches),
        hydrateCandidates: vi.fn(async (_db: unknown, ids: string[]) => state.matches.filter(m => ids.includes(m.adopterId))),
    };
});

import {
    previewInterviewCandidates, startInterview, saveInterviewDraft, refreshInterviewCandidates,
    getInterview, listMyInterviewDrafts, verifyInterviewFact, discardInterviewDraft,
} from './interviews';

type Sqlite = { prepare: (s: string) => { get: (...a: unknown[]) => Record<string, unknown> | undefined; run: (...a: unknown[]) => unknown } };
let sqlite: Sqlite;
const PREP = { name: 'Juan Pérez', phones: ['11 6585-1333'], emails: [], socials: [], address: '' };
const cand = (id: string, over: Partial<CandidateSummary> = {}): CandidateSummary => ({
    adopterId: id, displayName: 'Juan', relevancePercent: 70, avgRating: null, adoptionCount: 0, canEdit: false, stored: ['phones'], visible: {}, ...over,
});
const emptyPatch = { answers: {}, visited: [], custom: [], leadCandidateId: null };

beforeEach(() => {
    const m = migratedDb();
    state.db = m.db;
    sqlite = m.sqlite as unknown as Sqlite;
    state.flag = true;
    state.matches = [];
    session.user = OWNER;
    sqlite.prepare(`INSERT INTO adopters (id, name, status, added_by, contact_entries, created_at, updated_at, deleted_at, is_demo)
        VALUES ('a1', 'Juan Pérez', '5', ?, ?, 1000, 1000, NULL, 0)`).run(STRANGER, JSON.stringify([{ type: 'phone', value: '+5491165851333' }]));
});

describe('interview actions — gate', () => {
    it('flag off: every action refuses with "disabled"', async () => {
        state.flag = false;
        expect(await previewInterviewCandidates(PREP)).toEqual({ ok: false, error: 'disabled' });
        expect(await startInterview({ prep: PREP })).toEqual({ ok: false, error: 'disabled' });
        expect(await listMyInterviewDrafts()).toEqual({ ok: false, error: 'disabled' });
    });
    it('signed out: refused', async () => {
        session.user = null;
        const r = await startInterview({ prep: PREP });
        expect(r.ok).toBe(false);
    });
});

describe('startInterview / drafts', () => {
    it('records the server-side match as candidates and keeps a valid lead', async () => {
        state.matches = [cand('a1')];
        const r = await startInterview({ prep: PREP, leadCandidateId: 'a1' });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const row = sqlite.prepare('SELECT * FROM interviews WHERE id = ?').get(r.interviewId)!;
        expect(JSON.parse(row.candidate_ids_json as string)).toEqual(['a1']);
        expect(r.view.leadCandidateId).toBe('a1');
        expect(row.conducted_by).toBe(OWNER);
    });

    it('a lead the server did not find is dropped (no forged candidates)', async () => {
        state.matches = [];
        const r = await startInterview({ prep: PREP, leadCandidateId: 'a1' });
        expect(r.ok && r.view.leadCandidateId).toBe(null);
    });

    it('from a profile: starts confirmed on that profile', async () => {
        state.matches = [cand('a1')];
        const r = await startInterview({ adopterId: 'a1' });
        expect(r.ok && r.view.confirmedAdopterId).toBe('a1');
        expect(r.ok && r.view.sourceKind).toBe('profile');
    });

    it('starting from the same profile twice resumes the open draft', async () => {
        state.matches = [cand('a1')];
        const a = await startInterview({ adopterId: 'a1' });
        const b = await startInterview({ adopterId: 'a1' });
        expect(a.ok && b.ok && a.interviewId === b.interviewId).toBe(true);
        expect(sqlite.prepare(`SELECT count(*) AS n FROM interviews`).get()!.n).toBe(1);
    });

    it('only the interviewer can save, read or discard a draft', async () => {
        const r = await startInterview({ prep: PREP });
        if (!r.ok) throw new Error('start failed');
        session.user = MATE;
        expect(await saveInterviewDraft(r.interviewId, emptyPatch)).toEqual({ ok: false, error: 'forbidden' });
        expect((await getInterview(r.interviewId)).ok).toBe(false);
        expect(await discardInterviewDraft(r.interviewId)).toEqual({ ok: false, error: 'forbidden' });
    });

    it('saves answers; refuses invalid payloads; never revives a completed interview', async () => {
        const r = await startInterview({ prep: PREP });
        if (!r.ok) throw new Error('start failed');
        const ok = await saveInterviewDraft(r.interviewId, { ...emptyPatch, answers: { rapport_work: { status: 'answered', text: 'Enfermera' } }, visited: ['rapport_work'] });
        expect(ok.ok).toBe(true);
        expect((await saveInterviewDraft(r.interviewId, { ...emptyPatch, answers: { rapport_work: { status: 'answered', text: 'x'.repeat(5000) } } } as never))).toEqual({ ok: false, error: 'invalid' });
        sqlite.prepare(`UPDATE interviews SET status = 'completed' WHERE id = ?`).run(r.interviewId);
        expect(await saveInterviewDraft(r.interviewId, emptyPatch)).toEqual({ ok: false, error: 'invalid' });
        const row = sqlite.prepare('SELECT status FROM interviews WHERE id = ?').get(r.interviewId)!;
        expect(row.status).toBe('completed');
    });

    it('lists only my open drafts with answered counts', async () => {
        const r = await startInterview({ prep: PREP });
        if (!r.ok) throw new Error('start failed');
        await saveInterviewDraft(r.interviewId, { ...emptyPatch, answers: { rapport_work: { status: 'answered', text: 'x' } }, visited: ['rapport_work'] });
        session.user = MATE;
        await startInterview({ prep: { ...PREP, name: 'Otra Persona' } });
        session.user = OWNER;
        const l = await listMyInterviewDrafts();
        expect(l.ok && l.drafts.map(d => [d.name, d.answeredCount])).toEqual([['Juan Pérez', 1]]);
    });
});

describe('refreshInterviewCandidates / verifyInterviewFact', () => {
    it('refresh unions newly matched ids into the stored candidates', async () => {
        const r = await startInterview({ prep: PREP });
        if (!r.ok) throw new Error('start failed');
        state.matches = [cand('a1')];
        const f = await refreshInterviewCandidates(r.interviewId);
        expect(f.ok && f.candidates.map(c => c.adopterId)).toEqual(['a1']);
        const row = sqlite.prepare('SELECT candidate_ids_json FROM interviews WHERE id = ?').get(r.interviewId)!;
        expect(JSON.parse(row.candidate_ids_json as string)).toEqual(['a1']);
    });

    it('verify compares the STORED answers with the raw profile and returns only a boolean', async () => {
        state.matches = [cand('a1')];
        const r = await startInterview({ prep: { ...PREP, phones: [] } });
        if (!r.ok) throw new Error('start failed');
        await saveInterviewDraft(r.interviewId, { ...emptyPatch,
            answers: { rapport_phone: { status: 'answered', contacts: [{ type: 'phone', value: '11 6585-1333' }] } }, visited: ['rapport_phone'] });
        const v = await verifyInterviewFact(r.interviewId, 'a1', 'phones');
        expect(v).toEqual({ ok: true, match: true });
        expect(Object.keys(v)).toEqual(['ok', 'match']);
    });

    it('verify refuses a profile that is not one of this interview’s candidates', async () => {
        const r = await startInterview({ prep: PREP });
        if (!r.ok) throw new Error('start failed');
        expect(await verifyInterviewFact(r.interviewId, 'a1', 'phones')).toEqual({ ok: false, error: 'forbidden' });
    });
});
