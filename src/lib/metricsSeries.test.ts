import { describe, it, expect } from 'vitest';
import { mapSeriesToPoints } from './metricsSeries';

const DAY = 86_400_000;
const d = (s: string) => Date.parse(s);

describe('mapSeriesToPoints', () => {
    const expected = [d('2026-07-08T00:00:00Z'), d('2026-07-09T00:00:00Z'), d('2026-07-10T00:00:00Z')];

    it('fills missing buckets with zero and preserves order', () => {
        const series = [
            { startTime: '2026-07-08T00:00:00Z', groups: [{ aggregations: [{ value: 4 }] }] },
            // 07-09 missing entirely
            { startTime: '2026-07-10T00:00:00Z', groups: [{ aggregations: [{ value: 1 }] }] },
        ];
        expect(mapSeriesToPoints(series, expected)).toEqual([
            { t: expected[0], value: 4 },
            { t: expected[1], value: 0 },
            { t: expected[2], value: 1 },
        ]);
    });

    it('treats null/undefined values and undefined series as zero', () => {
        const series = [{ startTime: '2026-07-09T00:00:00Z', groups: [{ aggregations: [{ value: null }] }] }];
        expect(mapSeriesToPoints(series, expected).map(p => p.value)).toEqual([0, 0, 0]);
        expect(mapSeriesToPoints(undefined, expected).map(p => p.value)).toEqual([0, 0, 0]);
    });

    it('floors an off-boundary bucket timestamp to its expected start', () => {
        const series = [{ startTime: '2026-07-10T00:00:00.123Z', groups: [{ aggregations: [{ value: 7 }] }] }];
        const pts = mapSeriesToPoints(series, expected);
        expect(pts[2]).toEqual({ t: d('2026-07-10T00:00:00Z'), value: 7 });
    });
});
