import { describe, it, expect } from 'vitest';
import { getRatingDisplayLevel, getRatingLabelKey, isLowRating } from './ratings';

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
        for (const r of [1, 2.49, 2.5]) expect(isLowRating(r)).toBe(['dangerous', 'poor'].includes(getRatingLabelKey(r)));
    });
    it('unrated is never low', () => {
        for (const r of [null, undefined, 0, -1, 6, NaN]) expect(isLowRating(r as number | null | undefined)).toBe(false);
    });
});
