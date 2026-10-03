import { describe, it, expect } from 'vitest';
import { answerSignal } from './answerSignals';

describe('answerSignal', () => {
    it('children in the home are something to talk about, not a red flag', () => {
        expect(answerSignal('children', 'none')).toBe('ok');
        for (const n of ['1', '2', '3+']) expect(answerSignal('children', n)).toBe('caution');
    });

    it('an unprotected space is a likely dealbreaker; "no aplica" says nothing', () => {
        expect(answerSignal('isSafe', 'yes')).toBe('ok');
        expect(answerSignal('isSafe', 'no')).toBe('risk');
        expect(answerSignal('isSafe', 'na')).toBeNull();
    });

    it('adopting as a gift is a likely dealbreaker', () => {
        expect(answerSignal('intent', 'self')).toBe('ok');
        expect(answerSignal('intent', 'gift')).toBe('risk');
    });

    it('stays silent for unanswered, unknown values and every other question', () => {
        expect(answerSignal('children', undefined)).toBeNull();
        expect(answerSignal('children', '')).toBeNull();
        expect(answerSignal('isSafe', 'maybe')).toBeNull();
        expect(answerSignal('intent', 'other')).toBeNull();
        expect(answerSignal('hoursAlone', '6+')).toBeNull();
        expect(answerSignal('housingType', 'apartment')).toBeNull();
    });
});
