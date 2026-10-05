// Stub — filled in by Task 12.
'use client';
import type { Answer, CandidateSummary, CustomQuestion, QueueItem } from '@/domain/interview/types';
export default function InterviewFocusPanel(_: { interviewId: string; item: QueueItem | null; answer: Answer | null; custom: CustomQuestion[]; candidates: CandidateSummary[]; onAnswer: (id: string, a: Answer | null) => void; onNext: (fromId: string | null) => void; onBlurAnswer: () => void; flush: () => Promise<boolean> }) { return null; }
