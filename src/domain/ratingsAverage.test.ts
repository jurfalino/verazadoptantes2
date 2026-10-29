import { describe, it, expect } from 'vitest';
import { computeAvgRating } from './ratings';

describe('computeAvgRating — 0 and null both mean "not rated"', () => {
    it('[4, 0] averages to 4', () => {
        expect(computeAvgRating([{ rating: 4 }, { rating: 0 }])).toBe(4);
    });
    it('[4, null] averages to 4', () => {
        expect(computeAvgRating([{ rating: 4 }, { rating: null }])).toBe(4);
    });
    it('only unrated records: null, never 0', () => {
        expect(computeAvgRating([{ rating: 0 }, { rating: null }])).toBeNull();
        expect(computeAvgRating([])).toBeNull();
    });
    it('real ratings still average normally', () => {
        expect(computeAvgRating([{ rating: 5 }, { rating: 3 }, { rating: 0 }])).toBe(4);
    });
});
