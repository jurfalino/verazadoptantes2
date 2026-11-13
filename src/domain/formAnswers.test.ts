import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/context/LanguageContext', () => ({
    useLanguage: () => ({ t: (k: string) => k }),
}));

import FormAnswersPanel from '@/components/FormAnswersPanel';
import { summarizeAnswers, answerShown, FORM_ANSWER_SECTIONS } from './formAnswers';

describe('answerShown', () => {
    it('hides empty values, blank open answers and all-zero pets', () => {
        expect(answerShown('x', undefined)).toBe(false);
        expect(answerShown('x', null)).toBe(false);
        expect(answerShown('x', '')).toBe(false);
        expect(answerShown('motivation', { open: '' })).toBe(false);
        expect(answerShown('motivation', { open: 'hola' })).toBe(true);
        expect(answerShown('existingPets', 'dog')).toBe(false);
        expect(answerShown('existingPets', { dog: 0 })).toBe(false);
        expect(answerShown('existingPets', { dog: 2 })).toBe(true);
        expect(answerShown('specialNeeds', false)).toBe(true);
        expect(answerShown('isSafe', 'yes')).toBe(true);
    });
});

describe('summarizeAnswers', () => {
    it('flags red before amber, in section order; counts the rest the panel would show', () => {
        const r = summarizeAnswers({ intent: 'gift', children: '2', isSafe: 'yes', allergy: 'yes', housingType: 'house', motivation: { open: '' }, existingPets: { dog: 0 } });
        expect(r.flagged).toEqual([{ field: 'intent', signal: 'risk' }, { field: 'children', signal: 'caution' }, { field: 'allergy', signal: 'caution' }]);
        expect(r.restCount).toBe(2);
    });
    it('a household-people form: the people row is flagged with its worst person', () => {
        expect(summarizeAnswers({ children: '1', householdPeople: [{ relationship: 'child', age: 3 }, { relationship: 'partner', age: 40 }] }).flagged)
            .toEqual([{ field: 'household', signal: 'risk' }]);
        expect(summarizeAnswers({ children: '1', householdPeople: [{ relationship: 'partner', age: 40 }] })).toEqual({ flagged: [], restCount: 1 });
        expect(summarizeAnswers({ children: '1', householdPeople: [{ relationship: 'child', age: 10 }] }).flagged)
            .toEqual([{ field: 'household', signal: 'caution' }]);
    });
    it('counts exactly the rows FormAnswersPanel renders', () => {
        const fixtures: Record<string, unknown>[] = [
            {
                ageRange: '26-35', carer: 'minor', lastAnimal: 'lost', petExperience: 'some', gaveAway: 'no', instagram: '@x', motivation: { open: 'quiero' }, howHeard: 'friend',
                children: '2', allergy: 'no', existingPets: { dog: 1, cat: 0 }, petsCare: 'vet', housingType: 'house', rental: 'owner', hasOutdoor: 'yes', isSafe: 'na', sleepPlace: 'inside', hoursAlone: '4',
                species: 'dog', lifeStage: 'puppy', intent: 'self',
                specialNeeds: false, willingToSterilize: 'yes', vetCommitment: true, visitConsent: 'yes',
                geo: 'yes', legal: true,
                blank: '', gaveAwayWhy: '',
            },
            { children: '1', householdPeople: [{ relationship: 'child', age: 3 }], livesAlone: false, isSafe: 'no', intent: 'gift', existingPets: {} },
            { children: 'none', householdPeople: [], livesAlone: true },
            { motivation: { open: '' }, existingPets: { dog: 0 }, species: 'dog' },
        ];
        for (const f of fixtures) {
            const html = renderToStaticMarkup(createElement(FormAnswersPanel, { fullAnswers: f }));
            const rows = (html.match(/data-testid="answer-row"/g) ?? []).length;
            const s = summarizeAnswers(f);
            // a household row is an AnswerRow too (key household, default testId)
            expect(s.flagged.length + s.restCount).toBe(rows);
        }
    });
    it('no red or amber → flagged empty', () => {
        expect(summarizeAnswers({ isSafe: 'yes' }).flagged).toEqual([]);
    });
    it('sections are the panel ones', () => {
        expect(FORM_ANSWER_SECTIONS.map((s) => s.id)).toEqual(['identity', 'household', 'preferences', 'commitments', 'context']);
    });
});
