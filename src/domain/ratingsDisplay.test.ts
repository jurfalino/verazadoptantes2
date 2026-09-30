import { describe, it, expect } from 'vitest';
import { getRatingDisplayLevel } from './ratings';

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
