import { describe, it, expect } from 'vitest';
import { INTERVIEW_LIMITS as L, parseInterviewNumber } from './limits';
import { draftPatchSchema, prepSchema } from './validation';

describe('parseInterviewNumber', () => {
    it('clears to null, ignores non-numbers, clamps to 0..1000', () => {
        expect(parseInterviewNumber('')).toBeNull();
        expect(parseInterviewNumber('abc')).toBeUndefined();
        expect(parseInterviewNumber('NaN')).toBeUndefined();
        expect(parseInterviewNumber('12')).toBe(12);
        expect(parseInterviewNumber('-5')).toBe(0);
        expect(parseInterviewNumber('99999')).toBe(1000);
    });
});

describe('the schema accepts exactly what the inputs allow', () => {
    const draft = (answers: unknown, custom: unknown[] = []) => draftPatchSchema.safeParse({ answers, visited: [], custom, leadCandidateId: null }).success;
    it('answer text, contact value, household name, number', () => {
        expect(draft({ story_home: { status: 'answered', text: 'x'.repeat(L.answerText) } })).toBe(true);
        expect(draft({ story_home: { status: 'answered', text: 'x'.repeat(L.answerText + 1) } })).toBe(false);
        expect(draft({ rapport_phone: { status: 'answered', contacts: [{ type: 'phone', value: '1'.repeat(L.contactValue) }] } })).toBe(true);
        expect(draft({ rapport_phone: { status: 'answered', contacts: [{ type: 'phone', value: '1'.repeat(L.contactValue + 1) }] } })).toBe(false);
        expect(draft({ story_household: { status: 'answered', household: [{ name: 'a'.repeat(L.householdName), relationship: null }] } })).toBe(true);
        expect(draft({ story_household: { status: 'answered', household: [{ name: 'a'.repeat(L.householdName + 1), relationship: null }] } })).toBe(false);
        expect(draft({ details_budget: { status: 'answered', number: parseInterviewNumber('5000')! } })).toBe(true);
    });
    it('custom question and prep fields', () => {
        expect(draft({}, [{ id: 'custom:1', stage: 'story', text: 'q'.repeat(L.customQuestion) }])).toBe(true);
        expect(draft({}, [{ id: 'custom:1', stage: 'story', text: 'q'.repeat(L.customQuestion + 1) }])).toBe(false);
        const prep = { name: 'n'.repeat(L.prepName), phones: ['1'.repeat(L.prepRow)], emails: [], socials: [], address: 'a'.repeat(L.prepAddress) };
        expect(prepSchema.safeParse(prep).success).toBe(true);
        expect(prepSchema.safeParse({ ...prep, address: prep.address + 'a' }).success).toBe(false);
        expect(prepSchema.safeParse({ ...prep, phones: [prep.phones[0] + '1'] }).success).toBe(false);
    });
});
