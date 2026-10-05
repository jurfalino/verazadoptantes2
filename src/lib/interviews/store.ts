/**
 * Interview persistence + candidate plumbing. Not 'use server': these are
 * trusted helpers that the actions in src/app/actions/interviews.ts call
 * after their own session/flag/ownership checks.
 */
import { eq } from 'drizzle-orm';
import { interviews } from '@/db/schema';
import { findFormDuplicates } from '@/app/actions/findFormDuplicates';
import { hydrateDuplicateMatches } from '@/app/actions/hydrateDuplicateMatches';
import type { DuplicateMatch } from '@/app/actions/types';
import { logger } from '@/lib/logger';
import type { Answer, CandidateSummary, CustomQuestion, InterviewContext, KnownFacts, PrepFacts } from '@/domain/interview/types';
import { EMPTY_PREP } from '@/domain/interview/types';
import { toCandidateSummary } from './candidates';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- same Db handle type the other action helpers take
type Db = any;

export interface InterviewState {
    id: string;
    conductedBy: string;
    status: 'draft' | 'completed' | 'discarded';
    sourceKind: 'standalone' | 'profile';
    sourceId: string | null;
    prep: PrepFacts;
    leadCandidateId: string | null;
    confirmedAdopterId: string | null;
    answers: Record<string, Answer>;
    visited: string[];
    custom: CustomQuestion[];
    candidateIds: string[];
    adopterId: string | null;
    eventId: string | null;
    updatedAt: Date | null;
    completedAt: Date | null;
}

type JsonColumn = 'prep_json' | 'answers_json' | 'candidate_ids_json';

/** Corrupt JSON degrades to the fallback, but is logged (id + column only, never the content). */
function parseJson<T>(raw: string | null | undefined, fallback: T, interviewId: string, column: JsonColumn): T {
    if (!raw) return fallback;
    try { return JSON.parse(raw) as T; } catch {
        logger.warn('interviews.parse: corrupt JSON column', { interviewId, column });
        return fallback;
    }
}

export function parseInterviewRow(row: typeof interviews.$inferSelect): InterviewState {
    const prepBlob = parseJson<{ prep?: PrepFacts; leadCandidateId?: string | null; confirmedAdopterId?: string | null }>(row.prepJson, {}, row.id, 'prep_json');
    const ans = parseJson<{ answers?: Record<string, Answer>; visited?: string[]; custom?: CustomQuestion[] }>(row.answersJson, {}, row.id, 'answers_json');
    return {
        id: row.id,
        conductedBy: row.conductedBy,
        status: row.status as InterviewState['status'],
        sourceKind: row.sourceKind as InterviewState['sourceKind'],
        sourceId: row.sourceId,
        prep: { ...EMPTY_PREP, ...prepBlob.prep },
        leadCandidateId: prepBlob.leadCandidateId ?? null,
        confirmedAdopterId: prepBlob.confirmedAdopterId ?? null,
        answers: ans.answers ?? {},
        visited: ans.visited ?? [],
        custom: ans.custom ?? [],
        candidateIds: parseJson<string[]>(row.candidateIdsJson, [], row.id, 'candidate_ids_json'),
        adopterId: row.adopterId,
        eventId: row.eventId,
        updatedAt: row.updatedAt ?? null,
        completedAt: row.completedAt ?? null,
    };
}

export async function loadInterview(db: Db, id: string): Promise<InterviewState | null> {
    const row = await db.select().from(interviews).where(eq(interviews.id, id)).get();
    return row ? parseInterviewRow(row) : null;
}

export function prepJson(s: Pick<InterviewState, 'prep' | 'leadCandidateId' | 'confirmedAdopterId'>): string {
    return JSON.stringify({ prep: s.prep, leadCandidateId: s.leadCandidateId, confirmedAdopterId: s.confirmedAdopterId });
}
export function answersJson(s: Pick<InterviewState, 'answers' | 'visited' | 'custom'>): string {
    return JSON.stringify({ answers: s.answers, visited: s.visited, custom: s.custom });
}

export function contextFor(s: InterviewState, candidates: CandidateSummary[]): InterviewContext {
    return {
        prep: s.prep, answers: s.answers, visited: s.visited, custom: s.custom, candidates,
        ...(s.confirmedAdopterId ? { confirmedAdopterId: s.confirmedAdopterId } : {}),
    };
}

/** Run the duplicate engine on what the interview knows (no address: D9). */
export async function matchCandidates(known: KnownFacts, viewerIsAdmin: boolean): Promise<CandidateSummary[]> {
    if (known.name.length < 2) return [];
    const { results } = await findFormDuplicates({ name: known.name, phones: known.phones, emails: known.emails, socials: known.socials });
    return results.filter(m => !m.adopter.deletedAt).map(m => toCandidateSummary(m, { viewerIsAdmin }));
}

/** Re-hydrate stored candidate ids through the same masked bridge. */
export async function hydrateCandidates(db: Db, ids: string[], viewer: string, viewerIsAdmin: boolean): Promise<CandidateSummary[]> {
    if (!ids.length) return [];
    const stubs: DuplicateMatch[] = ids.map(adopterId => ({ adopterId, adopterName: '', relevancePercent: 0, matchTypes: [], matchValues: [], source: 'token' }));
    const hydrated = await hydrateDuplicateMatches(db, stubs, { viewer, isUnauthenticated: false });
    return hydrated.filter(m => !m.adopter.deletedAt).map(m => toCandidateSummary(m, { viewerIsAdmin }));
}

/** Fresh results win (they carry relevance); stored ones that dropped out are kept. */
export function mergeCandidates(fresh: CandidateSummary[], stored: CandidateSummary[]): CandidateSummary[] {
    const seen = new Set(fresh.map(c => c.adopterId));
    return [...fresh, ...stored.filter(c => !seen.has(c.adopterId))];
}
