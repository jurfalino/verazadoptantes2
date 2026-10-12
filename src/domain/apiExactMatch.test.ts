import { describe, it, expect } from 'vitest';
import {
    isFullName, namesCompatible, decideExactOutcome, phoneLookups,
    normalizeDocumentId, isUsableDocumentId, type CandidateNames,
} from './apiExactMatch';

const cand = (profileId: string, name: string, extra: Partial<CandidateNames> = {}): CandidateNames =>
    ({ profileId, name, aliases: [], householdNames: [], ...extra });

describe('isFullName', () => {
    it('needs two real words', () => {
        expect(isFullName('María Pérez')).toBe(true);
        expect(isFullName('María')).toBe(false);
        expect(isFullName('María P')).toBe(false);
        expect(isFullName('  ')).toBe(false);
    });
});

describe('namesCompatible', () => {
    it('ignores accents, case and order', () => {
        expect(namesCompatible('maria PEREZ', 'Pérez, María')).toBe(true);
    });
    it('accepts a missing middle name or second surname either way', () => {
        expect(namesCompatible('María Pérez', 'María José Pérez Gómez')).toBe(true);
        expect(namesCompatible('María José Pérez Gómez', 'María Pérez')).toBe(true);
    });
    it('accepts one typo per long word, not on short words', () => {
        expect(namesCompatible('Maria Peres', 'María Pérez')).toBe(true);
        expect(namesCompatible('Ana Paz', 'Ama Paz')).toBe(false);
    });
    it('rejects a different surname', () => {
        expect(namesCompatible('María Gómez', 'María Pérez')).toBe(false);
    });
    it('uses each stored word once', () => {
        expect(namesCompatible('Juan Juan', 'Juan Pérez')).toBe(false);
    });
});

describe('decideExactOutcome', () => {
    it('no identifier hit → not_found', () => {
        expect(decideExactOutcome('María Pérez', [])).toEqual({ result: 'not_found' });
    });
    it('one profile, consistent name → found', () => {
        expect(decideExactOutcome('María Pérez', [cand('a', 'María José Pérez')]))
            .toEqual({ result: 'found', profileId: 'a', nameMatchedAs: 'profile', otherProfileIds: [] });
    });
    it('one profile, the name is an alias or a household member → found, says which', () => {
        expect(decideExactOutcome('Mery Pérez', [cand('a', 'María Pérez', { aliases: ['Mery Pérez'] })]))
            .toMatchObject({ result: 'found', nameMatchedAs: 'alias' });
        expect(decideExactOutcome('Carlos Pérez', [cand('a', 'María Pérez', { householdNames: ['Carlos Pérez'] })]))
            .toMatchObject({ result: 'found', nameMatchedAs: 'household_member' });
    });
    it('one profile, unrelated name (shared family phone) → ambiguous name_mismatch', () => {
        expect(decideExactOutcome('Laura Gómez', [cand('a', 'María Pérez')]))
            .toEqual({ result: 'ambiguous', reason: 'name_mismatch', profileIds: ['a'] });
    });
    it('several profiles, exactly one consistent → found that one', () => {
        // ...and still reports the other hit, so a flagged profile under another name can't hide.
        expect(decideExactOutcome('María Pérez', [cand('a', 'Laura Gómez'), cand('b', 'María Pérez')]))
            .toMatchObject({ result: 'found', profileId: 'b', otherProfileIds: ['a'] });
    });
    it('several profiles, none or several consistent → ambiguous multiple_profiles', () => {
        expect(decideExactOutcome('María Pérez', [cand('a', 'María Pérez'), cand('b', 'María Pérez López')]))
            .toEqual({ result: 'ambiguous', reason: 'multiple_profiles', profileIds: ['a', 'b'] });
        expect(decideExactOutcome('Ana Ruiz', [cand('a', 'María Pérez'), cand('b', 'Laura Gómez')]))
            .toMatchObject({ result: 'ambiguous', reason: 'multiple_profiles' });
    });
});

describe('phoneLookups', () => {
    it('an international number also looks up its last 8 digits as phone and suffix', () => {
        expect(phoneLookups('+54 9 11 6462-2274')).toEqual([
            { type: 'phone', value: '5491164622274' },
            { type: 'phone', value: '64622274' },
            { type: 'phone_suffix', value: '64622274' },
        ]);
    });
    it('an 8-digit number is its own suffix', () => {
        expect(phoneLookups('6462-2274')).toEqual([
            { type: 'phone', value: '64622274' },
            { type: 'phone_suffix', value: '64622274' },
        ]);
    });
    it('too short to be a phone → nothing', () => {
        expect(phoneLookups('12-345')).toEqual([]);
    });
});

describe('document id', () => {
    it('normalizes like the tokenizer', () => {
        expect(normalizeDocumentId('30.123.456')).toBe('30123456');
        expect(normalizeDocumentId('V-12345678')).toBe('v12345678');
    });
    it('rejects ids the index never stores', () => {
        expect(isUsableDocumentId('30.123.456')).toBe(true);
        expect(isUsableDocumentId('AB12')).toBe(false);
    });
});
