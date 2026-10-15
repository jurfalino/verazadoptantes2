import { describe, it, expect } from 'vitest';
import {
    isFullName, namesCompatible, decideExactOutcome, pickBestMatch,
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
            .toEqual({ result: 'ambiguous', reason: 'name_mismatch', profileIds: ['a'], compatible: [] });
    });
    it('several profiles, exactly one consistent → found that one', () => {
        // ...and still reports the other hit, so a flagged profile under another name can't hide.
        expect(decideExactOutcome('María Pérez', [cand('a', 'Laura Gómez'), cand('b', 'María Pérez')]))
            .toMatchObject({ result: 'found', profileId: 'b', otherProfileIds: ['a'] });
    });
    it('several profiles, none or several consistent → ambiguous multiple_profiles', () => {
        expect(decideExactOutcome('María Pérez', [cand('a', 'María Pérez'), cand('b', 'María Pérez López')]))
            .toEqual({ result: 'ambiguous', reason: 'multiple_profiles', profileIds: ['a', 'b'], compatible: [{ profileId: 'a', as: 'profile' }, { profileId: 'b', as: 'profile' }] });
        expect(decideExactOutcome('Ana Ruiz', [cand('a', 'María Pérez'), cand('b', 'Laura Gómez')]))
            .toMatchObject({ result: 'ambiguous', reason: 'multiple_profiles', compatible: [] });
    });
});

describe('pickBestMatch (ambiguous, several names fit)', () => {
    const fit = (profileId: string, as: 'profile' | 'alias' | 'household_member' = 'profile') => ({ profileId, as });
    it('no name fits → null (a new profile is created instead)', () => {
        expect(pickBestMatch([], new Map(), new Map())).toBeNull();
    });
    it('most identifiers matched wins', () => {
        expect(pickBestMatch([fit('a'), fit('b')], new Map([['a', ['phone']], ['b', ['phone', 'email']]]), new Map())).toBe('b');
    });
    it('then the closest name: the profile\'s own over an alias over a household member', () => {
        const on = new Map([['a', ['phone']], ['b', ['phone']], ['c', ['phone']]]);
        expect(pickBestMatch([fit('a', 'household_member'), fit('b', 'alias'), fit('c')], on, new Map())).toBe('c');
        expect(pickBestMatch([fit('a', 'household_member'), fit('b', 'alias')], on, new Map())).toBe('b');
    });
    it('then the most recent activity; undated loses', () => {
        const on = new Map([['a', ['phone']], ['b', ['phone']]]);
        expect(pickBestMatch([fit('a'), fit('b')], on, new Map([['a', '2025-01-01T00:00:00Z'], ['b', '2026-01-01T00:00:00Z']]))).toBe('b');
        expect(pickBestMatch([fit('a'), fit('b')], on, new Map([['a', '2025-01-01T00:00:00Z'], ['b', null]]))).toBe('a');
    });
    it('a full tie is still deterministic', () => {
        expect(pickBestMatch([fit('b'), fit('a')], new Map(), new Map())).toBe('a');
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
