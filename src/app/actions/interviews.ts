'use server';

/**
 * Interview guide actions (spec .agents/plans/interview-guide.md §6).
 * Every export: session required, ENABLE_INTERVIEW_GUIDE on, and drafts are
 * the interviewer's alone. Logs carry ids and counts only — never answers,
 * prep facts or identifiers.
 */
import { and, desc, eq } from 'drizzle-orm';
import { getDb, getUser } from './_db';
import { getFeatureFlag } from '@/config/features';
import { logger } from '@/lib/logger';
import { adopters, interviews } from '@/db/schema';
import { deriveKnownFacts } from '@/domain/interview/facts';
import { factMatches } from '@/domain/interview/verify';
import { canViewInterviewAnswers } from '@/domain/interview/access';
import { QUESTION_BANK } from '@/domain/interview/bank';
import type { CandidateSummary, PrepFacts, VerifiableFact } from '@/domain/interview/types';
import { VERIFIABLE_FACTS } from '@/domain/interview/types';
import { storedFactValues } from '@/lib/interviews/candidates';
import {
    answersJson, contextFor, hydrateCandidates, loadInterview, matchCandidates, mergeCandidates, parseInterviewRow, prepJson,
    type InterviewState,
} from '@/lib/interviews/store';
import { draftPatchSchema, prepSchema, type DraftPatch } from '@/lib/interviews/validation';
import type { ActionResult, DraftSummary, InterviewView } from './interviewTypes';

class Refusal extends Error {
    constructor(public code: 'disabled' | 'not_found' | 'forbidden' | 'invalid') { super(code); }
}

async function gate(): Promise<{ actor: string; actorIsAdmin: boolean }> {
    if (!(await getFeatureFlag('ENABLE_INTERVIEW_GUIDE'))) throw new Refusal('disabled');
    const actor = await getUser();
    const { isAdminAsync } = await import('@/config/admins');
    return { actor, actorIsAdmin: await isAdminAsync(actor) };
}

function refuse<T>(e: unknown, op: string, ctx: Record<string, unknown>): ActionResult<T> {
    if (e instanceof Refusal) return { ok: false, error: e.code };
    if (e instanceof Error && e.message === 'Authentication required') return { ok: false, error: 'forbidden' };
    return { ok: false, error: 'generic', errorId: logger.error(`interviews.${op} failed`, e, ctx) };
}

async function ownDraft(db: unknown, id: string, actor: string): Promise<InterviewState> {
    const s = await loadInterview(db, id);
    if (!s) throw new Refusal('not_found');
    if (s.conductedBy !== actor) throw new Refusal('forbidden');
    if (s.status !== 'draft') throw new Refusal('invalid');
    return s;
}

async function conductorName(email: string): Promise<string> {
    try {
        const { resolveUserNames } = await import('./userNames');
        const map = await resolveUserNames([email]);
        return map[email] || email.split('@')[0];
    } catch (e) {
        logger.warn('interviews.conductorName: name lookup fell back to handle', { error: e instanceof Error ? e.message : String(e) });
        return email.split('@')[0];
    }
}

async function toView(s: InterviewState, candidates: CandidateSummary[], canEdit: boolean): Promise<InterviewView> {
    return {
        id: s.id, status: s.status, sourceKind: s.sourceKind, prep: s.prep,
        leadCandidateId: s.leadCandidateId, confirmedAdopterId: s.confirmedAdopterId,
        answers: s.answers, visited: s.visited, custom: s.custom, candidates,
        adopterId: s.adopterId, conductedByName: await conductorName(s.conductedBy), canEdit,
        completedAt: s.completedAt ? Math.floor(s.completedAt.getTime() / 1000) : null,
    };
}

export async function previewInterviewCandidates(prep: PrepFacts): Promise<ActionResult<{ candidates: CandidateSummary[] }>> {
    let actor: string | undefined;
    try {
        const g = await gate();
        actor = g.actor;
        const db = await getDb();
        if (!db) throw new Error('Database not available');
        const parsed = prepSchema.safeParse(prep);
        if (!parsed.success) return { ok: true, candidates: [] };
        const known = deriveKnownFacts({ prep: parsed.data, answers: {}, visited: [], custom: [], candidates: [] }, QUESTION_BANK);
        return { ok: true, candidates: await matchCandidates(db, known, g.actor, g.actorIsAdmin) };
    } catch (e) {
        return refuse(e, 'preview', { actor });
    }
}

export async function startInterview(input: { prep?: PrepFacts; leadCandidateId?: string | null; adopterId?: string }): Promise<ActionResult<{ interviewId: string; view: InterviewView }>> {
    let actor: string | undefined;
    const adopterId = input?.adopterId ? String(input.adopterId).slice(0, 64) : undefined;
    try {
        const g = await gate();
        actor = g.actor;
        const db = await getDb();
        if (!db) throw new Error('Database not available');
        const id = crypto.randomUUID();
        let state: InterviewState;
        let candidates: CandidateSummary[];

        if (adopterId) {
            // One open draft per (interviewer, profile): a re-click or a StrictMode double effect resumes it.
            const open = await db.select().from(interviews).where(and(
                eq(interviews.conductedBy, actor), eq(interviews.status, 'draft'),
                eq(interviews.sourceKind, 'profile'), eq(interviews.sourceId, adopterId),
            )).get();
            if (open) {
                const existing = parseInterviewRow(open);
                const cands = await hydrateCandidates(db, existing.candidateIds, actor, g.actorIsAdmin);
                return { ok: true, interviewId: existing.id, view: await toView(existing, cands, true) };
            }
            candidates = await hydrateCandidates(db, [adopterId], actor, g.actorIsAdmin);
            if (!candidates.length) throw new Refusal('not_found');
            state = {
                id, conductedBy: actor, status: 'draft', sourceKind: 'profile', sourceId: adopterId,
                prep: { name: candidates[0].displayName, phones: [], emails: [], socials: [], address: '' },
                leadCandidateId: adopterId, confirmedAdopterId: adopterId,
                answers: {}, visited: [], custom: [], candidateIds: [adopterId],
                adopterId: null, eventId: null, updatedAt: null, completedAt: null,
            };
        } else {
            const parsed = prepSchema.safeParse(input?.prep);
            if (!parsed.success) throw new Refusal('invalid');
            const known = deriveKnownFacts({ prep: parsed.data, answers: {}, visited: [], custom: [], candidates: [] }, QUESTION_BANK);
            candidates = await matchCandidates(db, known, g.actor, g.actorIsAdmin);
            const ids = candidates.map(c => c.adopterId);
            const lead = input.leadCandidateId && ids.includes(input.leadCandidateId) ? input.leadCandidateId : null;
            state = {
                id, conductedBy: actor, status: 'draft', sourceKind: 'standalone', sourceId: null,
                prep: parsed.data, leadCandidateId: lead, confirmedAdopterId: null,
                answers: {}, visited: [], custom: [], candidateIds: ids,
                adopterId: null, eventId: null, updatedAt: null, completedAt: null,
            };
        }

        await db.insert(interviews).values({
            id, conductedBy: actor, status: 'draft', sourceKind: state.sourceKind, sourceId: state.sourceId,
            prepJson: prepJson(state), answersJson: answersJson(state), candidateIdsJson: JSON.stringify(state.candidateIds),
            createdAt: new Date(), updatedAt: new Date(),
        });
        logger.info('interviews.start', { interviewId: id, actor, sourceKind: state.sourceKind, candidateCount: candidates.length });
        return { ok: true, interviewId: id, view: await toView(state, candidates, true) };
    } catch (e) {
        return refuse(e, 'start', { actor, adopterId });
    }
}

export async function saveInterviewDraft(interviewId: string, patch: DraftPatch): Promise<ActionResult<{ updatedAt: number }>> {
    let actor: string | undefined;
    try {
        actor = (await gate()).actor;
        const db = await getDb();
        if (!db) throw new Error('Database not available');
        const parsed = draftPatchSchema.safeParse(patch);
        if (!parsed.success) throw new Refusal('invalid');
        const s = await ownDraft(db, String(interviewId), actor);
        const lead = parsed.data.leadCandidateId && s.candidateIds.includes(parsed.data.leadCandidateId) ? parsed.data.leadCandidateId : null;
        const now = new Date();
        await db.update(interviews).set({
            answersJson: answersJson(parsed.data),
            prepJson: prepJson({ ...s, leadCandidateId: lead }),
            updatedAt: now,
        }).where(and(eq(interviews.id, s.id), eq(interviews.status, 'draft')));
        return { ok: true, updatedAt: Math.floor(now.getTime() / 1000) };
    } catch (e) {
        return refuse(e, 'saveDraft', { actor, interviewId });
    }
}

export async function refreshInterviewCandidates(interviewId: string): Promise<ActionResult<{ candidates: CandidateSummary[] }>> {
    let actor: string | undefined;
    try {
        const g = await gate();
        actor = g.actor;
        const db = await getDb();
        if (!db) throw new Error('Database not available');
        const s = await ownDraft(db, String(interviewId), actor);
        const known = deriveKnownFacts(contextFor(s, []), QUESTION_BANK);
        const [fresh, stored] = await Promise.all([
            s.confirmedAdopterId ? Promise.resolve([]) : matchCandidates(db, known, g.actor, g.actorIsAdmin),
            hydrateCandidates(db, s.candidateIds, actor, g.actorIsAdmin),
        ]);
        const candidates = mergeCandidates(fresh, stored);
        const ids = [...new Set([...s.candidateIds, ...candidates.map(c => c.adopterId)])];
        if (ids.length !== s.candidateIds.length) {
            await db.update(interviews).set({ candidateIdsJson: JSON.stringify(ids), updatedAt: new Date() }).where(eq(interviews.id, s.id));
        }
        return { ok: true, candidates };
    } catch (e) {
        return refuse(e, 'refreshCandidates', { actor, interviewId });
    }
}

export async function getInterview(interviewId: string): Promise<ActionResult<{ view: InterviewView }>> {
    let actor: string | undefined;
    try {
        const g = await gate();
        actor = g.actor;
        const db = await getDb();
        if (!db) throw new Error('Database not available');
        const s = await loadInterview(db, String(interviewId));
        if (!s || s.status === 'discarded') throw new Refusal('not_found');
        if (s.status === 'draft') {
            if (s.conductedBy !== actor) throw new Refusal('forbidden');
            const candidates = await hydrateCandidates(db, s.candidateIds, actor, g.actorIsAdmin);
            return { ok: true, view: await toView(s, candidates, true) };
        }
        const owner = s.adopterId
            ? (await db.select({ addedBy: adopters.addedBy }).from(adopters).where(eq(adopters.id, s.adopterId)).get())?.addedBy ?? null
            : null;
        const { isOrgMate } = await import('@/lib/orgMembership');
        const allowed = canViewInterviewAnswers({
            viewer: actor, conductedBy: s.conductedBy, ownerEmail: owner,
            viewerIsAdmin: g.actorIsAdmin, viewerIsOrgMate: owner ? await isOrgMate(actor, owner) : false,
        });
        if (!allowed) throw new Refusal('forbidden');
        return { ok: true, view: await toView(s, [], false) };
    } catch (e) {
        return refuse(e, 'get', { actor, interviewId });
    }
}

export async function listMyInterviewDrafts(): Promise<ActionResult<{ drafts: DraftSummary[] }>> {
    let actor: string | undefined;
    try {
        actor = (await gate()).actor;
        const db = await getDb();
        if (!db) throw new Error('Database not available');
        const rows = await db.select().from(interviews)
            .where(and(eq(interviews.conductedBy, actor), eq(interviews.status, 'draft')))
            .orderBy(desc(interviews.updatedAt)).limit(10).all();
        const drafts: DraftSummary[] = rows.map((row: typeof interviews.$inferSelect) => {
            const s = parseInterviewRow(row);
            return {
                id: s.id, name: s.prep.name,
                answeredCount: Object.values(s.answers).filter(a => a.status === 'answered').length,
                updatedAt: s.updatedAt ? Math.floor(s.updatedAt.getTime() / 1000) : null,
            };
        });
        return { ok: true, drafts };
    } catch (e) {
        return refuse(e, 'listDrafts', { actor });
    }
}

export async function verifyInterviewFact(interviewId: string, candidateId: string, fact: VerifiableFact): Promise<ActionResult<{ match: boolean }>> {
    let actor: string | undefined;
    try {
        actor = (await gate()).actor;
        if (!VERIFIABLE_FACTS.includes(fact)) throw new Refusal('invalid');
        const db = await getDb();
        if (!db) throw new Error('Database not available');
        const s = await ownDraft(db, String(interviewId), actor);
        if (!s.candidateIds.includes(String(candidateId))) throw new Refusal('forbidden');
        const row = await db.select({ contactEntries: adopters.contactEntries, contactInfo: adopters.contactInfo, addressInfo: adopters.addressInfo })
            .from(adopters).where(eq(adopters.id, String(candidateId))).get();
        if (!row) throw new Refusal('not_found');
        const known = deriveKnownFacts(contextFor(s, []), QUESTION_BANK);
        const given = fact === 'address' ? (known.address ? [known.address] : []) : known[fact];
        return { ok: true, match: factMatches(fact, storedFactValues(row, fact), given) };
    } catch (e) {
        return refuse(e, 'verify', { actor, interviewId, candidateId, fact });
    }
}

export async function discardInterviewDraft(interviewId: string): Promise<ActionResult<object>> {
    let actor: string | undefined;
    try {
        actor = (await gate()).actor;
        const db = await getDb();
        if (!db) throw new Error('Database not available');
        const s = await ownDraft(db, String(interviewId), actor);
        await db.update(interviews).set({ status: 'discarded', updatedAt: new Date() }).where(eq(interviews.id, s.id));
        logger.info('interviews.discard', { interviewId: s.id, actor });
        return { ok: true };
    } catch (e) {
        return refuse(e, 'discard', { actor, interviewId });
    }
}
