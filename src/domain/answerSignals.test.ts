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

import { personSignal } from './answerSignals';
describe('personSignal', () => {
    it('under 5 is red, 5–17 amber, adults green', () => {
        expect(personSignal(0)).toBe('risk');
        expect(personSignal(4)).toBe('risk');
        expect(personSignal(5)).toBe('caution');
        expect(personSignal(17)).toBe('caution');
        expect(personSignal(18)).toBe('ok');
        expect(personSignal(80)).toBe('ok');
    });
});

describe('"No sé" never gets a dot', () => {
    it('unknown is null', () => {
        for (const f of ['children', 'isSafe', 'intent']) expect(answerSignal(f, 'unknown')).toBeNull();
    });
});

describe('new questions (spec 2026-10-14 §5)', () => {
    const cases: Array<[string, string, ReturnType<typeof answerSignal>]> = [
        ['movingIfNoPets', 'return', 'risk'], ['movingIfNoPets', 'family', 'caution'], ['movingIfNoPets', 'find', null],
        ['gaveAway', 'yes', 'risk'], ['gaveAway', 'no', null],
        ['lastAnimal', 'lost', 'risk'], ['lastAnimal', 'street', 'risk'], ['lastAnimal', 'gave', 'risk'], ['lastAnimal', 'oldAge', null],
        ['returnReasons', 'baby', 'caution'], ['returnReasons', 'behaviour', 'caution'], ['returnReasons', 'no', null],
        ['willingToSterilize', 'no', 'risk'], ['willingToSterilize', 'yes', null],
        ['catOutdoor', 'yes', 'risk'], ['catOutdoor', 'sometimes', 'caution'], ['catOutdoor', 'no', null],
        ['sleepPlace', 'outside', 'caution'], ['sleepPlace', 'inside', null],
        ['rental', 'rentNotAllowed', 'caution'], ['rental', 'rentUnsure', 'caution'], ['rental', 'own', null],
        ['visitConsent', 'no', 'risk'], ['visitConsent', 'videoOnly', null],
        ['adaptPlan', 'return', 'risk'], ['adaptPlan', 'patience', null],
        ['dogTied', 'yes', 'risk'], ['dogTied', 'sometimes', 'caution'],
        ['carer', 'minor', 'caution'], ['carer', 'me', null],
        ['allergy', 'yes', 'caution'], ['allergy', 'unknown', null],
        ['catOutdoor', 'unknown', null],
    ];
    it.each(cases)('%s = %s → %s', (field, value, expected) => {
        expect(answerSignal(field, value)).toBe(expected);
    });
});

describe('free-text answers (release 3) never get a dot', () => {
    it('even when the text reads like an option', () => {
        expect(answerSignal('gaveAway', { open: 'yes' })).toBeNull();
        expect(answerSignal('catOutdoor', { open: 'yes' })).toBeNull();
    });
});
