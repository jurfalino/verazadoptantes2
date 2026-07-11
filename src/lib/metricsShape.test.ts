import { describe, it, expect } from 'vitest';
import { sumSeries } from './metricsShape';

describe('sumSeries', () => {
    it('sums point values, treating null series as 0', () => {
        expect(sumSeries([{ t: 1, value: 2 }, { t: 2, value: 3 }])).toBe(5);
        expect(sumSeries(null)).toBe(0);
        expect(sumSeries([])).toBe(0);
    });
});
