export type Window = '24h' | '7d' | '30d';

export interface BucketSpec { resolution: '1h' | '24h'; ms: number }

const HOUR = 3_600_000;
const DAY = 86_400_000;

const WINDOW_BUCKETS: Record<Window, BucketSpec> = {
    '24h': { resolution: '1h', ms: HOUR },
    '7d': { resolution: '24h', ms: DAY },
    '30d': { resolution: '24h', ms: DAY },
};

const WINDOW_SPAN_MS: Record<Window, number> = {
    '24h': 24 * HOUR,
    '7d': 7 * DAY,
    '30d': 30 * DAY,
};

export function windowToBucket(w: Window): BucketSpec {
    return WINDOW_BUCKETS[w];
}

export function roundDownToBucket(epochMs: number, bucketMs: number): number {
    return Math.floor(epochMs / bucketMs) * bucketMs;
}

/** Ascending bucket-start epochs. The final bucket is the one containing `now`
 *  (floored to the bucket); we include exactly span/bucket buckets. */
export function bucketStartsMs(w: Window, nowMs: number): number[] {
    const { ms } = windowToBucket(w);
    const lastStart = roundDownToBucket(nowMs, ms);
    const count = Math.round(WINDOW_SPAN_MS[w] / ms);
    const firstStart = lastStart - (count - 1) * ms;
    const out: number[] = [];
    for (let i = 0; i < count; i++) out.push(firstStart + i * ms);
    return out;
}

/** Rounded ISO range for the Axiom query (stable within a bucket → cache-friendly).
 *  endTime is exclusive: last bucket start + one bucket. */
export function windowRangeIso(w: Window, nowMs: number): { startTime: string; endTime: string } {
    const { ms } = windowToBucket(w);
    const starts = bucketStartsMs(w, nowMs);
    const startTime = new Date(starts[0]).toISOString();
    const endTime = new Date(starts[starts.length - 1] + ms).toISOString();
    return { startTime, endTime };
}

export function computeTrend(current: number, prev: number): { pct: number | null; dir: 'up' | 'down' | 'flat' } {
    const dir = current > prev ? 'up' : current < prev ? 'down' : 'flat';
    if (prev === 0) return { pct: null, dir };
    const pct = Math.round(((current - prev) / prev) * 100);
    return { pct, dir };
}
