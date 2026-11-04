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
        for (const r of [1, 1.4, 2, 2.49]) expect(isLowRating(r), String(r)).toBe(true);
        for (const r of [2.5, 3, 4, 5]) expect(isLowRating(r), String(r)).toBe(false);
        for (const r of [1, 2.44, 2.45, 2.49, 2.5]) expect(isLowRating(r)).toBe(['dangerous', 'poor'].includes(getRatingLabelKey(r)));
    });
    it('re-review M-a: the chip follows the badge\'s word, and writes the badge\'s own number', () => {
        // 2.45 and 2.49 read «2.5 · Malo» on the badge: «Malo», so the housemate chip shows («… 2.5»).
        for (const r of [2.45, 2.49]) {
            expect(getRatingLabelKey(r)).toBe('poor');
            expect(isLowRating(r)).toBe(true);
            expect(formatRating(r)).toBe('2.5');
        }
        // 1.45 is «1.4 · Peligroso», low, and still bans (the raw average, untouched).
        expect(formatRating(1.45)).toBe('1.4');
        expect(isLowRating(1.45)).toBe(true);
        expect(ratingBansAdopting(1.45)).toBe(true);
        expect(formatRating(2)).toBe('2.0');
    });
    it('unrated is never low', () => {
        for (const r of [null, undefined, 0, -1, 6, NaN]) expect(isLowRating(r as number | null | undefined)).toBe(false);
    });
});
