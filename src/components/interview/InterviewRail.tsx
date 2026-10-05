// Stub — filled in by Task 12.
'use client';
import type { Answer, CustomQuestion, QueueItem, Stage } from '@/domain/interview/types';
export default function InterviewRail(_: { queue: QueueItem[]; answers: Record<string, Answer>; custom: CustomQuestion[]; currentId: string | null; onSelect: (id: string) => void; onAddCustom: (text: string, stage: Stage) => void }) { return null; }
