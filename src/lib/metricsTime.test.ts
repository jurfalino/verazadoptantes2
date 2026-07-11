import { describe, it, expect } from 'vitest';
import { windowToBucket, roundDownToBucket, bucketStartsMs, windowRangeIso, computeTrend } from './metricsTime';

const DAY = 86_400_000;
const HOUR = 3_600_000;

describe('windowToBucket', () => {
    it('maps 24h to hourly, 7d/30d to daily', () => {
        expect(windowToBucket('24h')).toEqual({ resolution: '1h', ms: HOUR });
        expect(windowToBucket('7d')).toEqual({ resolution: '24h', ms: DAY });
        expect(windowToBucket('30d')).toEqual({ resolution: '24h', ms: DAY });
    });
});

describe('roundDownToBucket', () => {
    it('floors an epoch to the bucket boundary', () => {
        // 2026-07-10T13:37:00Z rounded to day = 2026-07-10T00:00:00Z
        const t = Date.parse('2026-07-10T13:37:00Z');
        expect(roundDownToBucket(t, DAY)).toBe(Date.parse('2026-07-10T00:00:00Z'));
        expect(roundDownToBucket(t, HOUR)).toBe(Date.parse('2026-07-10T13:00:00Z'));
    });
});

describe('bucketStartsMs', () => {
    it('returns 7 ascending day-starts for a 7d window', () => {
        const now = Date.parse('2026-07-10T13:37:00Z');
        const starts = bucketStartsMs('7d', now);
        expect(starts).toHaveLength(7);
        // last bucket is the day containing `now`, floored
        expect(starts[6]).toBe(Date.parse('2026-07-10T00:00:00Z'));
        expect(starts[0]).toBe(Date.parse('2026-07-04T00:00:00Z'));
        // strictly ascending, exactly one day apart
        for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBe(DAY);
    });
    it('returns 24 hourly starts for a 24h window', () => {
        const now = Date.parse('2026-07-10T13:37:00Z');
        expect(bucketStartsMs('24h', now)).toHaveLength(24);
    });
});

describe('windowRangeIso', () => {
    it('rounds start and end to the bucket for cache stability', () => {
        const now = Date.parse('2026-07-10T13:37:00Z');
        const { startTime, endTime } = windowRangeIso('7d', now);
        expect(endTime).toBe('2026-07-11T00:00:00.000Z'); // exclusive end = last bucket start + 1 bucket
        expect(startTime).toBe('2026-07-04T00:00:00.000Z');
    });
});

describe('computeTrend', () => {
    it('computes percent change and direction', () => {
        expect(computeTrend(5, 2)).toEqual({ pct: 150, dir: 'up' });
        expect(computeTrend(8, 10)).toEqual({ pct: -20, dir: 'down' });
        expect(computeTrend(4, 4)).toEqual({ pct: 0, dir: 'flat' });
    });
    it('returns null pct when the prior period is zero (no baseline)', () => {
        expect(computeTrend(3, 0)).toEqual({ pct: null, dir: 'up' });
        expect(computeTrend(0, 0)).toEqual({ pct: null, dir: 'flat' });
    });
});
