import { describe, it, expect } from 'vitest';
import { ratingBansAdopting } from './ratings';

describe('ratingBansAdopting (adopter sign-in gate)', () => {
    it('only a profile shown as 1★ bans', () => {
        expect(ratingBansAdopting(1)).toBe(true);
        expect(ratingBansAdopting(1.4)).toBe(true);
    });
    it('2★ and above sign in normally (it used to be anything below 4)', () => {
        expect(ratingBansAdopting(1.5)).toBe(false);
        expect(ratingBansAdopting(2)).toBe(false);
        expect(ratingBansAdopting(3.9)).toBe(false);
        expect(ratingBansAdopting(5)).toBe(false);
    });
    it('unrated never bans', () => {
        expect(ratingBansAdopting(null)).toBe(false);
        expect(ratingBansAdopting(undefined)).toBe(false);
    });
});
