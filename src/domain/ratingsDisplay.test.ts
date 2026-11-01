import { describe, it, expect } from 'vitest';
import { formatRating, getRatingDisplayLevel, getRatingLabelKey, isLowRating, ratingBansAdopting } from './ratings';

describe('getRatingDisplayLevel', () => {
    it('0 / null / NaN means "not rated yet": no filled star', () => {
        expect(getRatingDisplayLevel(0)).toBe(0);
        expect(getRatingDisplayLevel(null as unknown as number)).toBe(0);
        expect(getRatingDisplayLevel(NaN)).toBe(0);
        expect(getRatingDisplayLevel(-2)).toBe(0);
    });
    it('1..5 pass through, rounded and capped at 5', () => {
        expect(getRatingDisplayLevel(1)).toBe(1);
        expect(getRatingDisplayLevel(3.4)).toBe(3);
        expect(getRatingDisplayLevel(9)).toBe(5);
    });
});

describe('isLowRating (the 1★/2★ pills: «Peligroso», «Malo»)', () => {
    it('follows the pill\'s own bucket', () => {
        for (const r of [1, 1.4, 2, 2.44, 2.449]) expect(isLowRating(r), String(r)).toBe(true);
        for (const r of [2.45, 2.49, 2.5, 3, 4, 5]) expect(isLowRating(r), String(r)).toBe(false);
        for (const r of [1, 2.44, 2.5]) expect(isLowRating(r)).toBe(['dangerous', 'poor'].includes(getRatingLabelKey(r)));
    });
    it('review M6: decided on the number as written (formatRating), so the chip never shows a low «2.5»', () => {
        // 2.45 is written «2.5»: «Regular», not low (it used to read «2.5» and count as low).
        expect(formatRating(2.45)).toBe('2.5');
        expect(isLowRating(2.45)).toBe(false);
        // 2.449 is «2.4»: low.
        expect(formatRating(2.449)).toBe('2.4');
        expect(isLowRating(2.449)).toBe(true);
        // 1.45 is written «1.4» and stays low; the 1★ ban rule (raw average) is untouched.
        expect(formatRating(1.45)).toBe('1.4');
        expect(isLowRating(1.45)).toBe(true);
        expect(ratingBansAdopting(1.45)).toBe(true);
        expect(formatRating(2)).toBe('2.0');
    });
    it('unrated is never low', () => {
        for (const r of [null, undefined, 0, -1, 6, NaN]) expect(isLowRating(r as number | null | undefined)).toBe(false);
    });
});
