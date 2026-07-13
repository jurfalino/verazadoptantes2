export interface SeriesPoint { t: number; value: number }

export interface AxiomSeriesBucket {
    startTime: string;
    groups?: Array<{ aggregations?: Array<{ value: number | number[] | null }> }>;
}

/** Map Axiom series buckets onto the full expected bucket list, gap-filling
 *  missing/empty buckets with 0. `expectedStartsMs` MUST be ascending and evenly
 *  spaced (from bucketStartsMs). */
export function mapSeriesToPoints(
    series: AxiomSeriesBucket[] | undefined,
    expectedStartsMs: number[],
): SeriesPoint[] {
    if (expectedStartsMs.length === 0) return [];
    const bucketMs = expectedStartsMs.length > 1
        ? expectedStartsMs[1] - expectedStartsMs[0]
        : 86_400_000;
    const first = expectedStartsMs[0];
    const last = expectedStartsMs[expectedStartsMs.length - 1];

    const byStart = new Map<number, number>();
    for (const b of series ?? []) {
        const parsed = Date.parse(b.startTime);
        if (Number.isNaN(parsed)) continue;
        const floored = Math.floor(parsed / bucketMs) * bucketMs;
        if (floored < first || floored > last) continue;
        const raw = b.groups?.[0]?.aggregations?.[0]?.value;
        const value = typeof raw === 'number' ? raw : 0;
        byStart.set(floored, (byStart.get(floored) ?? 0) + value);
    }
    return expectedStartsMs.map(t => ({ t, value: byStart.get(t) ?? 0 }));
}
