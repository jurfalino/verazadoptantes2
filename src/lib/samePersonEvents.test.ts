import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/zaraz', () => ({ zarazTrack: vi.fn() }));
import { zarazTrack } from '@/lib/zaraz';
import { trackSamePersonAnswer } from './samePersonEvents';

describe('trackSamePersonAnswer — one event per «same person?» answer (spec 2026-11-05)', () => {
    beforeEach(() => vi.mocked(zarazTrack).mockClear());

    it('sends same_person_answered with surface, answer and own', () => {
        trackSamePersonAnswer('household', 'different', true);
        expect(zarazTrack).toHaveBeenCalledTimes(1);
        expect(zarazTrack).toHaveBeenCalledWith('same_person_answered', { surface: 'household', answer: 'different', own: true });
    });

    it('carries exactly those three properties — never a name, id or contact', () => {
        trackSamePersonAnswer('form_results', 'same', false);
        const props = vi.mocked(zarazTrack).mock.calls[0][1] as Record<string, unknown>;
        expect(Object.keys(props).sort()).toEqual(['answer', 'own', 'surface']);
    });
});
