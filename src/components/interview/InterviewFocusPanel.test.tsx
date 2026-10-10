import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ t: (k: string) => k, locale: 'es' }) }));
vi.mock('@/app/actions/interviews', () => ({ verifyInterviewFact: vi.fn() }));
vi.mock('@/lib/clientErrorReporter', () => ({ resolveErrorId: vi.fn() }));

import InterviewFocusPanel from './InterviewFocusPanel';
import { buildQueue } from '@/domain/interview/queue';
import { EMPTY_PREP, type Answer, type CandidateSummary } from '@/domain/interview/types';
import { verifyCacheKey } from './verifyTargets';

const candidates: CandidateSummary[] = [{
    adopterId: 'a1', displayName: 'Juan', relevancePercent: 70, avgRating: null, adoptionCount: 0, canEdit: false, stored: ['phones'], visible: {},
}];
const answer: Answer = { status: 'answered', contacts: [{ type: 'phone', value: '11 6585-1333' }] };
const item = buildQueue({
    prep: { ...EMPTY_PREP, name: 'Juan' }, answers: { details_other_phones: answer }, visited: ['details_other_phones'], custom: [], candidates,
}).find(i => i.id === 'details_other_phones')!;

const render = (cache: Map<string, boolean | 'refused'>) => renderToStaticMarkup(
    <InterviewFocusPanel interviewId="i1" item={item} answer={answer} custom={[]} candidates={candidates}
        onAnswer={() => {}} onNext={() => {}} onBlurAnswer={() => {}} flush={async () => true} verifyCache={{ current: cache }} />,
);

describe('InterviewFocusPanel verification hints', () => {
    it('stay mounted once the question is answered', () => {
        const html = render(new Map());
        expect(html).toContain('data-testid="interview-verify"');
        expect(html).toContain('data-testid="interview-verify-a1"');
        expect(html).toContain('interview.verify_pending');
    });
    it('a refused comparison shows a neutral line instead of nothing', () => {
        const html = render(new Map([[verifyCacheKey('details_other_phones', 'a1', answer), 'refused']]));
        expect(html).toContain('interview.verify_unavailable');
        expect(html).not.toContain('interview.verify_nomatch');
    });
    it('a cached match is shown', () => {
        const html = render(new Map([[verifyCacheKey('details_other_phones', 'a1', answer), true]]));
        expect(html).toContain('interview.verify_match');
    });
});
