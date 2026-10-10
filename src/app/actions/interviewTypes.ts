import type { Answer, CandidateSummary, CustomQuestion, PrepFacts } from '@/domain/interview/types';

export type InterviewError = 'disabled' | 'not_found' | 'forbidden' | 'invalid' | 'generic';
export type ActionResult<T> = ({ ok: true } & T) | { ok: false; error: InterviewError; errorId?: string };

export interface InterviewView {
    id: string;
    status: 'draft' | 'completed' | 'discarded';
    sourceKind: 'standalone' | 'profile';
    prep: PrepFacts;
    leadCandidateId: string | null;
    confirmedAdopterId: string | null;
    answers: Record<string, Answer>;
    visited: string[];
    custom: CustomQuestion[];
    candidates: CandidateSummary[];
    adopterId: string | null;
    /** Display name of the interviewer (name, else email handle). */
    conductedByName: string;
    /** True only for the interviewer while it is a draft. */
    canEdit: boolean;
    completedAt: number | null;
}

export interface DraftSummary { id: string; name: string; answeredCount: number; updatedAt: number | null }
