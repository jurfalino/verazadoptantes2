import { describe, it, expect } from 'vitest';
import { nameTokenMatches, maxNameEditDistance } from './scoring';

/**
 * Typo tolerance for name search.
 *
 * Regression origin: searching "jonatan daniel fernandez" did not surface the
 * stored "jonathan daniel fernandez". Exact substring matching scored the most
 * distinctive token at zero, so the record fell to `name_partial` at
 * round(20 × 2/3) = 13/100 while two common words carried the result.
 *
 * The design point these tests pin down: precision comes from RANKING, not from
 * refusing to match. Loosening the match is only safe because a token that only
 * fuzzy-matches still goes through `m / tokens.length` scaling — so "Daniela"
 * matching one of three tokens scores 7 against this record's 35.
 */
describe('maxNameEditDistance', () => {
    it('is strict for short names, where one edit is usually a different name', () => {
        expect(maxNameEditDistance('ana')).toBe(0);
        expect(maxNameEditDistance('jose')).toBe(0);
    });

    it('allows one edit for mid-length names', () => {
        expect(maxNameEditDistance('daniel')).toBe(1);
        expect(maxNameEditDistance('jonatan')).toBe(1);
    });

    it('allows two edits for long names, where typos are likelier than collisions', () => {
        expect(maxNameEditDistance('fernandez')).toBe(2);
        expect(maxNameEditDistance('bartolomeo')).toBe(2);
    });
});

describe('nameTokenMatches', () => {
    it('matches exact substrings, as before', () => {
        expect(nameTokenMatches('jonathan daniel fernandez', 'daniel')).toBe(true);
        expect(nameTokenMatches('jonathan daniel fernandez', 'fernandez')).toBe(true);
    });

    // The case that started this.
    it('matches a one-character misspelling of a mid-length given name', () => {
        expect(nameTokenMatches('jonathan daniel fernandez', 'jonatan')).toBe(true);
    });

    it('matches every token of the misspelled query, so the name_tokens tier applies', () => {
        const stored = 'jonathan daniel fernandez';
        const query = ['jonatan', 'daniel', 'fernandez'];
        expect(query.every(t => nameTokenMatches(stored, t))).toBe(true);
    });

    // Short names are where edit distance stops being typo tolerance and starts
    // conflating distinct people.
    it.each([
        ['rose maria', 'jose'],
        ['ada gomez', 'ana'],
        ['luiz silva', 'luis'],
    ])('does not conflate short names: %s vs %s', (stored, token) => {
        expect(nameTokenMatches(stored, token)).toBe(false);
    });

    it('does not match unrelated words of similar length', () => {
        expect(nameTokenMatches('martina lopez', 'fernandez')).toBe(false);
        expect(nameTokenMatches('pedro gonzalez', 'jonatan')).toBe(false);
    });

    // Accepted, deliberate consequence: this is a near-miss and it DOES match —
    // it is kept honest by scoring, not by the matcher. If this ever flips to
    // false, the "Daniela ranks at 7" expectation elsewhere is void.
    it('accepts daniel~daniela, which ranking is responsible for demoting', () => {
        expect(nameTokenMatches('daniela catania', 'daniel')).toBe(true);
    });

    it('is case-insensitive on the token side via lowercased input', () => {
        expect(nameTokenMatches('jonathan daniel fernandez', 'fernandes')).toBe(true);
    });
});
