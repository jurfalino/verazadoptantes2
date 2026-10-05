// Stub — filled in by Task 13.
'use client';
import type { CandidateSummary, KnownFacts } from '@/domain/interview/types';
export default function InterviewReview(_: { interviewId: string; known: KnownFacts; candidates: CandidateSummary[]; confirmedAdopterId: string | null; leadCandidateId: string | null; flush: () => Promise<boolean>; onBack: () => void; onSaved: (adopterId: string) => void }) { return null; }
