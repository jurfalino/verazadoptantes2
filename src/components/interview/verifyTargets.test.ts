import { describe, it, expect } from 'vitest';
import { buildQueue } from '@/domain/interview/queue';
import { EMPTY_PREP, type Answer, type CandidateSummary } from '@/domain/interview/types';
import { verifyCacheKey, verifyCallTargets } from './verifyTargets';

const cand = (id: string, over: Partial<CandidateSummary> = {}): CandidateSummary => ({
    adopterId: id, displayName: id, relevancePercent: 60, avgRating: null, adoptionCount: 0, canEdit: false, stored: [], visible: {}, ...over,
});
// One protected candidate (holds phones, shows none) and one that shows its phone (no server call needed).
const candidates = [cand('a1', { stored: ['phones'] }), cand('a2', { stored: ['phones'], visible: { phones: ['11 4444-0000'] } })];
const phone = (value: string): Answer => ({ status: 'answered', contacts: [{ type: 'phone', value }] });
// The item comes from the real queue for an ANSWERED question — what the panel receives after the first keystroke.
const itemFor = (answer: Answer) => buildQueue({
    prep: { ...EMPTY_PREP, name: 'Juan' }, answers: { details_other_phones: answer }, visited: ['details_other_phones'], custom: [], candidates,
}).find(i => i.id === 'details_other_phones')!;

describe('verifyCallTargets', () => {
    it('an answered question with a keyable phone asks the server about the protected candidate only', () => {
        const a = phone('11 6585-1333');
        const item = itemFor(a);
        expect(item.state).toBe('answered');
        expect(verifyCallTargets(item, a, candidates, () => false)).toEqual(['a1']);
    });
    it('a cached result for this exact answer means no call', () => {
        const a = phone('11 6585-1333');
        const cache = new Set([verifyCacheKey('details_other_phones', 'a1', a)]);
        expect(verifyCallTargets(itemFor(a), a, candidates, k => cache.has(k))).toEqual([]);
        // …but a different answer is a new comparison.
        const b = phone('11 6585-1334');
        expect(verifyCallTargets(itemFor(b), b, candidates, k => cache.has(k))).toEqual(['a1']);
    });
    it('a partial (4-digit) phone makes no call — it would spend budget and show a false ✗', () => {
        const a = phone('1165');
        expect(verifyCallTargets(itemFor(a), a, candidates, () => false)).toEqual([]);
    });
    it('more than 3 phones, or no answer, makes no call', () => {
        const four: Answer = { status: 'answered', contacts: ['1100000001', '1100000002', '1100000003', '1100000004'].map(value => ({ type: 'phone' as const, value })) };
        expect(verifyCallTargets(itemFor(four), four, candidates, () => false)).toEqual([]);
        expect(verifyCallTargets(itemFor(phone('11 6585-1333')), null, candidates, () => false)).toEqual([]);
    });
});
