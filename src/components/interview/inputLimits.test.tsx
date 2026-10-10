import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ t: (k: string) => k, locale: 'es' }) }));
vi.mock('@/components/ui/Toast', () => ({ useShowToast: () => ({ error: vi.fn(), success: vi.fn() }) }));
vi.mock('@/app/actions/interviews', () => ({ previewInterviewCandidates: vi.fn() }));
vi.mock('@/lib/clientErrorReporter', () => ({ resolveErrorId: vi.fn() }));

import InterviewAnswerInput from './InterviewAnswerInput';
import InterviewRail from './InterviewRail';
import InterviewPrep from './InterviewPrep';
import { EMPTY_PREP } from '@/domain/interview/types';

const noop = () => {};
const input = (kind: 'text' | 'number' | 'contact' | 'household') =>
    renderToStaticMarkup(<InterviewAnswerInput kind={kind} value={null} onChange={noop} onSubmit={noop} defaultContactType="phone" />);

describe('interview inputs never accept more than the draft schema', () => {
    it('answer inputs', () => {
        expect(input('text')).toContain('maxLength="4000"');
        expect(input('contact')).toContain('maxLength="300"');
        expect(input('household')).toContain('maxLength="120"');
        const n = input('number');
        expect(n).toContain('min="0"');
        expect(n).toContain('max="1000"');
    });
    it('custom question', () => {
        expect(renderToStaticMarkup(<InterviewRail queue={[]} answers={{}} custom={[]} currentId={null} onSelect={noop} onAddCustom={noop} />)).toContain('maxLength="500"');
    });
    it('prep fields', () => {
        const html = renderToStaticMarkup(<InterviewPrep prep={{ ...EMPTY_PREP }} onPrepChange={noop} leadCandidateId={null} onLeadChange={noop} onStart={noop} starting={false} />);
        expect(html).toMatch(/data-testid="interview-prep-name"[^>]*maxLength="200"|maxLength="200"[^>]*data-testid="interview-prep-name"/);
        expect(html).toMatch(/id="interview-prep-address"[^>]*maxLength="500"/);
        expect((html.match(/maxLength="300"/g) ?? []).length).toBe(3); // phone, social, email rows
    });
});
