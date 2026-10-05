import { describe, it, expect } from 'vitest';
import { contactKey, answerHasContent, deriveKnownFacts, identifierSignature } from './facts';
import type { InterviewContext, QuestionDef } from './types';
import { EMPTY_PREP } from './types';

const BANK: QuestionDef[] = [
    { id: 'q_phone', stage: 'rapport', kind: 'contact', priority: 1, fills: ['phones'] },
    { id: 'q_address', stage: 'story', kind: 'text', priority: 1, fills: ['address'] },
    { id: 'q_home', stage: 'story', kind: 'household', priority: 2, fills: ['household'] },
    { id: 'q_work', stage: 'rapport', kind: 'text', priority: 2, fills: ['work'] },
];

function ctx(over: Partial<InterviewContext> = {}): InterviewContext {
    return { prep: { ...EMPTY_PREP, name: 'Juan Pérez' }, answers: {}, visited: [], custom: [], candidates: [], ...over };
}

describe('contactKey', () => {
    it('phones compare on their last 8 digits, ignoring formatting and country code', () => {
        expect(contactKey('phone', '+54 9 11 6585-1333')).toBe(contactKey('phone', '1165851333'));
    });
    it('too-short phones are not identifiers', () => {
        expect(contactKey('phone', '12-34')).toBeNull();
    });
    it('emails are case-insensitive; socials reduce to the handle', () => {
        expect(contactKey('email', ' Juan@Mail.com ')).toBe('juan@mail.com');
        expect(contactKey('social', 'https://instagram.com/juan.perez')).toBe(contactKey('social', '@juan.perez'));
    });
});

describe('answerHasContent', () => {
    it('whitespace, empty rows and missing values are not content', () => {
        expect(answerHasContent({ status: 'answered', text: '   ' })).toBe(false);
        expect(answerHasContent({ status: 'answered', contacts: [{ type: 'phone', value: ' ' }] })).toBe(false);
        expect(answerHasContent({ status: 'answered', household: [{ name: ' ', relationship: null }] })).toBe(false);
        expect(answerHasContent({ status: 'answered', number: 0 })).toBe(true);
        expect(answerHasContent({ status: 'answered', choice: 'rent' })).toBe(true);
    });
});

describe('deriveKnownFacts', () => {
    it('prep identifiers count as known and fill their facts', () => {
        const k = deriveKnownFacts(ctx({ prep: { ...EMPTY_PREP, name: 'Juan', phones: ['11 6585 1333'], address: 'Calle 1' } }), BANK);
        expect(k.phones).toEqual(['11 6585 1333']);
        expect(k.filled).toEqual(['address', 'name', 'phones']);
    });

    it('answered questions fill their facts and add typed identifiers, de-duplicated', () => {
        const k = deriveKnownFacts(ctx({
            prep: { ...EMPTY_PREP, name: 'Juan', phones: ['1165851333'] },
            answers: {
                q_phone: { status: 'answered', contacts: [{ type: 'phone', value: '+54 11 6585-1333' }, { type: 'email', value: 'j@x.com' }] },
                q_work: { status: 'answered', text: 'Enfermera' },
                q_home: { status: 'answered', household: [{ name: 'Ana', relationship: 'partner' }] },
            },
        }), BANK);
        expect(k.phones).toHaveLength(1);
        expect(k.emails).toEqual(['j@x.com']);
        expect(k.household).toEqual([{ name: 'Ana', relationship: 'partner' }]);
        expect(k.filled).toEqual(expect.arrayContaining(['work', 'household', 'emails', 'phones']));
    });

    it('a cleared or skipped answer fills nothing', () => {
        const k = deriveKnownFacts(ctx({
            answers: { q_work: { status: 'answered', text: '  ' }, q_address: { status: 'skipped' } },
        }), BANK);
        expect(k.filled).toEqual(['name']);
    });

    it('the confirmed profile fills facts the viewer can see, but not protected ones', () => {
        const k = deriveKnownFacts(ctx({
            confirmedAdopterId: 'a1',
            candidates: [{ adopterId: 'a1', displayName: 'Juan', relevancePercent: 90, avgRating: null, adoptionCount: 0, canEdit: true,
                stored: ['phones', 'address'], visible: { phones: ['1165851333'] } }],
        }), BANK);
        expect(k.filled).toContain('phones');
        expect(k.filled).not.toContain('address');
        expect(k.phones).toEqual([]); // values are never copied from a profile
    });
});

describe('identifierSignature', () => {
    it('changes only when an identifier is added, not when wording differs', () => {
        const a = deriveKnownFacts(ctx({ prep: { ...EMPTY_PREP, name: 'Juan', phones: ['1165851333'] } }), BANK);
        const b = deriveKnownFacts(ctx({ prep: { ...EMPTY_PREP, name: 'Juan', phones: ['+54 11 6585-1333'] } }), BANK);
        const c = deriveKnownFacts(ctx({ prep: { ...EMPTY_PREP, name: 'Juan', phones: ['1165851333'], emails: ['j@x.com'] } }), BANK);
        expect(identifierSignature(a)).toBe(identifierSignature(b));
        expect(identifierSignature(a)).not.toBe(identifierSignature(c));
    });
});
