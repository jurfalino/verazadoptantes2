# Admin Metrics Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/admin/metrics` page that visualizes operational health and product usage as Axiom-sourced time-series charts, with an interactive 24h/7d/30d period selector.

**Architecture:** Extend the existing `src/lib/axiom.ts` query layer (already live: auth, env-scoping, cache, null-degradation) with a `getTimeSeries` function that reuses the existing `runQuery` plumbing plus a `resolution` for time-bucketing. A `fetchMetrics(window)` server action returns all cards' data; a client island renders hand-rolled SVG charts and re-fetches on period toggle. Pure logic (time bucketing, gap-fill, trend math) is split into standalone, unit-tested modules.

**Tech Stack:** Next.js 15 App Router (edge runtime), Cloudflare Pages, TypeScript, Drizzle (unused here), Axiom legacy query API, vitest, Playwright.

## Global Constraints

- **Edge runtime:** every new `page.tsx` and server action file that touches `axiom.ts` must be edge-compatible; admin pages start with `export const runtime = 'edge'`. No Node-only APIs.
- **i18n:** every user-facing string is a key added to **both** `src/i18n/locales/es.ts` and `src/i18n/locales/en.ts` (default locale is `es`). Missing an `es` key shows the raw key path.
- **No `inArray` / `IN (array)`** in any D1 query (not used in this feature, but the rule stands).
- **Lint ratchet:** total ESLint warnings must stay ≤ **125**. Run `npm run lint` before each commit.
- **Env-scoping:** all Axiom queries must remain env-scoped — `runQuery` already injects `env == getCurrentEnv()`; do not bypass it.
- **Graceful degradation:** an Axiom failure for one metric renders that card as "no disponible"; it must never blank the page or throw.
- **Deploy needs a version bump** (`npm version <v> --no-git-tag-version`) — only when we actually deploy, not per task-commit.
- **Tests:** `import { describe, it, expect } from 'vitest'`. Run a single file with `npx vitest run <path>`; full suite with `npm test`.

---

## File Structure

- `src/lib/metricsTime.ts` — pure time helpers: window→bucket, boundary rounding, bucket-timestamp generation, trend math. (Create)
- `src/lib/metricsSeries.ts` — pure Axiom-series → gap-filled points mapper. (Create)
- `src/lib/axiom.ts` — add `Window`/`MetricKey` types, `METRICS` registry, `getTimeSeries`, `resolution` support in `runQuery`. (Modify)
- `src/app/actions/metrics.ts` — `fetchMetrics(window)` server action. (Create)
- `src/app/actions/index.ts` — export `fetchMetrics`. (Modify)
- `src/components/charts/LineChart.tsx`, `BarChart.tsx`, `Sparkline.tsx` — SVG primitives. (Create)
- `src/components/admin/MetricCard.tsx` — one card (title, total, trend, chart, deep-link, "no disponible"). (Create)
- `src/components/admin/MetricsDashboard.tsx` — client island: period pills + card grid + re-fetch. (Create)
- `src/app/admin/metrics/page.tsx` — server component, initial SSR fetch. (Create)
- `src/components/AdminSidebar.tsx` — add nav entry. (Modify)
- `src/i18n/locales/{es,en}.ts` — new `admin.*` metric keys. (Modify)
- `tests/admin-metrics.spec.ts` — E2E. (Create)

---

## Task 1: Pure time & trend helpers

**Files:**
- Create: `src/lib/metricsTime.ts`
- Test: `src/lib/metricsTime.test.ts`

**Interfaces:**
- Produces:
  - `type Window = '24h' | '7d' | '30d'`
  - `interface BucketSpec { resolution: '1h' | '24h'; ms: number }`
  - `windowToBucket(w: Window): BucketSpec`
  - `roundDownToBucket(epochMs: number, bucketMs: number): number`
  - `bucketStartsMs(w: Window, nowMs: number): number[]` — ascending list of every bucket-start epoch-ms in the window (end rounded down to bucket; count = window/bucket).
  - `windowRangeIso(w: Window, nowMs: number): { startTime: string; endTime: string }` — ISO strings for the rounded range (for cache-stable Axiom queries).
  - `computeTrend(current: number, prev: number): { pct: number | null; dir: 'up' | 'down' | 'flat' }`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/metricsTime.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/metricsTime.test.ts`
Expected: FAIL — cannot find module `./metricsTime`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/metricsTime.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/metricsTime.test.ts`
Expected: PASS (all 8 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/lib/metricsTime.ts src/lib/metricsTime.test.ts
git commit -m "feat(metrics): pure time-bucketing + trend helpers"
```

---

## Task 2: Series → gap-filled points mapper

**Files:**
- Create: `src/lib/metricsSeries.ts`
- Test: `src/lib/metricsSeries.test.ts`

**Interfaces:**
- Consumes: `bucketStartsMs` from Task 1 (caller passes the resulting `expectedStartsMs`).
- Produces:
  - `interface SeriesPoint { t: number; value: number }`
  - `interface AxiomSeriesBucket { startTime: string; groups?: Array<{ aggregations?: Array<{ value: number | number[] | null }> }> }`
  - `mapSeriesToPoints(series: AxiomSeriesBucket[] | undefined, expectedStartsMs: number[]): SeriesPoint[]` — one point per expected bucket start, in ascending order; buckets absent from `series` (or with null/missing value) become `0`. Matches Axiom buckets to expected starts by flooring the bucket's `startTime` to the nearest expected start.

**Context:** Axiom's legacy query returns time buckets under `body.buckets.series[]`; each entry has a `startTime` and a `groups[]` (one group when there is no `groupBy`), whose `aggregations[0].value` is the metric value. Axiom may omit empty buckets, so we gap-fill against the expected bucket list from Task 1.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/metricsSeries.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/metricsSeries.test.ts`
Expected: FAIL — cannot find module `./metricsSeries`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/metricsSeries.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/metricsSeries.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/metricsSeries.ts src/lib/metricsSeries.test.ts
git commit -m "feat(metrics): gap-filling Axiom series mapper"
```

---

## Task 3: Metric registry + `getTimeSeries` in axiom.ts

**Files:**
- Modify: `src/lib/axiom.ts`
- Test: `src/lib/axiomMetrics.test.ts`

**Interfaces:**
- Consumes: `windowToBucket`, `bucketStartsMs`, `windowRangeIso` (Task 1); `mapSeriesToPoints`, `SeriesPoint` (Task 2); existing `runQuery`, `getQueryConfig`, `AxiomQueryBody`, `AxiomFilter`, `getAxiomDeepLinkUrl` (axiom.ts).
- Produces:
  - `type MetricKey = 'errors' | 'ai_failures' | 'signin_failures' | 'active_rescuers' | 'activity' | 'imports'`
  - `interface MetricDef { key: MetricKey; labelKey: string; chart: 'line' | 'bar'; filter?: AxiomFilter; deepLinkFilter?: string }`
  - `const METRICS: Record<MetricKey, MetricDef>`
  - `getTimeSeries(key: MetricKey, w: Window): Promise<SeriesPoint[] | null>`

**Context — `runQuery` change:** `AxiomQueryBody` currently has `{ startTime, endTime, aggregations, filter?, groupBy? }` and the code reads `buckets.totals`. Add an optional `resolution?: string`. When present, Axiom returns `buckets.series`. Also widen `AxiomQueryResponse` to include `series`.

- [ ] **Step 1: Add `resolution` to the query types (no test — type-only plumbing)**

In `src/lib/axiom.ts`, extend the interfaces:

```ts
interface AxiomQueryBody {
    startTime: string;
    endTime: string;
    aggregations: AxiomAggregation[];
    filter?: AxiomFilter;
    groupBy?: string[];
    resolution?: string; // e.g. '24h' | '1h'; when set, Axiom returns buckets.series
}

interface AxiomQueryResponse {
    buckets?: {
        totals?: Array<{
            group: Record<string, string | null>;
            aggregations: Array<{ op: string; value: number | number[] | null }>;
        }>;
        series?: Array<{
            startTime: string;
            groups?: Array<{ aggregations?: Array<{ value: number | number[] | null }> }>;
        }>;
    };
}
```

`runQuery` already spreads `body` into `finalBody`, so `resolution` flows through with no further change.

- [ ] **Step 2: Write the failing test for the METRICS registry**

```ts
// src/lib/axiomMetrics.test.ts
import { describe, it, expect } from 'vitest';
import { METRICS } from './axiom';

describe('METRICS registry', () => {
    it('defines all six metric keys with a chart type and label key', () => {
        const keys = ['errors', 'ai_failures', 'signin_failures', 'active_rescuers', 'activity', 'imports'];
        expect(Object.keys(METRICS).sort()).toEqual([...keys].sort());
        for (const k of keys) {
            expect(METRICS[k].labelKey).toMatch(/^admin\.metric_/);
            expect(['line', 'bar']).toContain(METRICS[k].chart);
        }
    });
    it('errors metric filters on level==error', () => {
        expect(METRICS.errors.filter).toEqual({ op: '==', field: 'level', value: 'error' });
    });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/axiomMetrics.test.ts`
Expected: FAIL — `METRICS` is not exported.

- [ ] **Step 4: Implement `METRICS` and `getTimeSeries`**

Add near the top of `src/lib/axiom.ts` (after the existing imports add the Task 1/2 imports):

```ts
import { windowToBucket, bucketStartsMs, windowRangeIso, type Window } from './metricsTime';
import { mapSeriesToPoints, type SeriesPoint } from './metricsSeries';

export type MetricKey = 'errors' | 'ai_failures' | 'signin_failures' | 'active_rescuers' | 'activity' | 'imports';

export interface MetricDef {
    key: MetricKey;
    labelKey: string;
    chart: 'line' | 'bar';
    filter?: AxiomFilter;
    deepLinkFilter?: string;
    agg?: AxiomAggregation; // defaults to count(*); active_rescuers uses distinct(user)
}
```

Also `export` the existing `AxiomAggregation` interface (currently internal) so `MetricDef` can reference it:

```ts
export interface AxiomAggregation {
    op: string;
    field?: string;
    argument?: number[];
}

export const METRICS: Record<MetricKey, MetricDef> = {
    errors: {
        key: 'errors', labelKey: 'admin.metric_errors', chart: 'line',
        filter: { op: '==', field: 'level', value: 'error' },
        deepLinkFilter: 'level=="error"',
    },
    ai_failures: {
        key: 'ai_failures', labelKey: 'admin.metric_ai_failures', chart: 'bar',
        filter: { op: '==', field: 'message', value: 'Gemini extraction failed' },
        deepLinkFilter: 'message=="Gemini extraction failed"',
    },
    signin_failures: {
        key: 'signin_failures', labelKey: 'admin.metric_signin_failures', chart: 'bar',
        filter: { op: 'or', children: [
            { op: '==', field: 'message', value: 'next-auth error' },
            { op: '==', field: 'message', value: 'auth-error page hit' },
        ] },
        deepLinkFilter: 'message=="next-auth error" or message=="auth-error page hit"',
    },
    active_rescuers: {
        key: 'active_rescuers', labelKey: 'admin.metric_active_rescuers', chart: 'line',
        filter: { op: '!=', field: 'user', value: '' },
        agg: { op: 'distinct', field: 'user' }, // distinct rescuers per bucket, not event volume
        deepLinkFilter: 'isnotnull(user)',
    },
    activity: {
        key: 'activity', labelKey: 'admin.metric_activity', chart: 'bar',
        filter: { op: '!=', field: 'user', value: '' },
    },
    imports: {
        key: 'imports', labelKey: 'admin.metric_imports', chart: 'line',
        filter: { op: '==', field: 'message', value: 'AI extraction completed' },
        deepLinkFilter: 'message=="AI extraction completed"',
    },
};

/** Time-bucketed count for a metric over the window, gap-filled. Null when Axiom
 *  is unavailable so the caller degrades the card to "no disponible". */
export async function getTimeSeries(key: MetricKey, w: Window): Promise<SeriesPoint[] | null> {
    const config = getQueryConfig();
    if (!config) return null;
    const def = METRICS[key];
    const { resolution } = windowToBucket(w);
    const { startTime, endTime } = windowRangeIso(w, Date.now());
    const data = await runQuery({
        startTime,
        endTime,
        aggregations: [def.agg ?? { op: 'count', field: '*' }],
        filter: def.filter,
        resolution,
    }, config);
    if (!data) return null;
    return mapSeriesToPoints(data.buckets?.series, bucketStartsMs(w, Date.parse(endTime) - 1));
}
```

Note: `Date.parse(endTime) - 1` gives a `now` inside the last bucket so `bucketStartsMs` reproduces the exact same bucket list the query used.

- [ ] **Step 5: Run the registry test**

Run: `npx vitest run src/lib/axiomMetrics.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: VERIFY THE LIVE RESPONSE SHAPE (external dependency — do not skip)**

The `buckets.series` shape above is the one external assumption. Confirm it against the real API before trusting the parser in production:
1. Temporarily add `console.log('AXIOM_SERIES', JSON.stringify(data?.buckets?.series?.slice(0,2)))` inside `getTimeSeries` after the `runQuery` call.
2. Deploy to staging (or run the existing app against staging creds) and load `/admin/metrics` once.
3. Read the log: `fly` is unrelated here — use `npx wrangler pages deployment tail --project-name verazadoptantes2` OR query Axiom for the console echo, and confirm each element has `startTime` and `groups[0].aggregations[0].value`.
4. If the shape differs (e.g. value is under a different path), adjust `mapSeriesToPoints`'s accessor and its test fixture, then remove the `console.log`.

Expected: series elements match `{ startTime, groups:[{ aggregations:[{ value }] }] }`. This step gates Task 4.

- [ ] **Step 8: Commit**

```bash
git add src/lib/axiom.ts src/lib/axiomMetrics.test.ts
git commit -m "feat(metrics): METRICS registry + getTimeSeries (resolution-based series)"
```

---

## Task 4: `fetchMetrics` server action

**Files:**
- Create: `src/app/actions/metrics.ts`
- Modify: `src/app/actions/index.ts`
- Test: `src/lib/metricsShape.test.ts`

**Interfaces:**
- Consumes: `getTimeSeries`, `METRICS`, `MetricKey`, `getTraceLatencies`, `getAxiomDeepLinkUrl` (axiom.ts); `computeTrend` (metricsTime); `SeriesPoint` (metricsSeries); `Window` (metricsTime).
- Produces:
  - `interface MetricCardData { key: MetricKey; total: number; trend: { pct: number|null; dir: 'up'|'down'|'flat' }; series: SeriesPoint[] | null; chart: 'line'|'bar'; labelKey: string; deepLink: string | null }`
  - `interface MetricsPayload { window: Window; cards: MetricCardData[]; latencies: TraceLatency[] | null; latencyDeepLink: string | null }`
  - `fetchMetrics(window: Window): Promise<MetricsPayload>`

**Context:** trend compares the current window total (summed from the series) against the **immediately-prior equal-length** period. The prior total comes from a dedicated `getPriorTotal` (added to axiom.ts in Step 5), which runs a single non-bucketed count over the shifted range. The pure reducer `sumSeries` is tested here; the network calls are exercised by the live smoke in Task 10.

- [ ] **Step 1: Write the failing test (pure summarize helper)**

`fetchMetrics` itself calls the network, so we unit-test the pure reducer it uses. Put the reducer in `metricsShape.ts`.

```ts
// src/lib/metricsShape.test.ts
import { describe, it, expect } from 'vitest';
import { sumSeries } from './metricsShape';

describe('sumSeries', () => {
    it('sums point values, treating null series as 0', () => {
        expect(sumSeries([{ t: 1, value: 2 }, { t: 2, value: 3 }])).toBe(5);
        expect(sumSeries(null)).toBe(0);
        expect(sumSeries([])).toBe(0);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/metricsShape.test.ts`
Expected: FAIL — cannot find `./metricsShape`.

- [ ] **Step 3: Implement the reducer**

```ts
// src/lib/metricsShape.ts
import type { SeriesPoint } from './metricsSeries';

export function sumSeries(series: SeriesPoint[] | null): number {
    if (!series) return 0;
    return series.reduce((acc, p) => acc + p.value, 0);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/metricsShape.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `getPriorTotal` and `windowIso` to axiom.ts**

The server action needs a prior-period total (for the trend) and an ISO range for the existing `getTraceLatencies` wrapper (which takes `{startTime,endTime}`). Add both to `src/lib/axiom.ts`, extending the Task-3 import from `./metricsTime` to also pull `windowRangeIso` (already imported there):

```ts
// src/lib/axiom.ts — windowRangeIso is already imported from './metricsTime' (Task 3)

/** ISO range for the CURRENT window — for callers needing {startTime,endTime}. */
export function windowIso(w: Window): { startTime: string; endTime: string } {
    return windowRangeIso(w, Date.now());
}

/** Total for the metric over the IMMEDIATELY-PRIOR equal-length window (for trend). */
export async function getPriorTotal(key: MetricKey, w: Window): Promise<number> {
    const config = getQueryConfig();
    if (!config) return 0;
    const span = { '24h': 24 * 3_600_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 }[w];
    const { startTime: curStart } = windowRangeIso(w, Date.now());
    const priorStart = new Date(Date.parse(curStart) - span).toISOString();
    const data = await runQuery({
        startTime: priorStart,
        endTime: curStart,
        aggregations: [METRICS[key].agg ?? { op: 'count', field: '*' }],
        filter: METRICS[key].filter,
    }, config);
    const total = data?.buckets?.totals?.[0]?.aggregations?.[0]?.value;
    return typeof total === 'number' ? total : 0;
}
```

Run `npx tsc --noEmit` — expected: no errors.

- [ ] **Step 6: Implement the server action**

```ts
// src/app/actions/metrics.ts
'use server';

import { getTimeSeries, getPriorTotal, windowIso, getTraceLatencies, getAxiomDeepLinkUrl, METRICS, type MetricKey, type TraceLatency } from '@/lib/axiom';
import { computeTrend, type Window } from '@/lib/metricsTime';
import { sumSeries } from '@/lib/metricsShape';
import type { SeriesPoint } from '@/lib/metricsSeries';

export interface MetricCardData {
    key: MetricKey;
    total: number;
    trend: { pct: number | null; dir: 'up' | 'down' | 'flat' };
    series: SeriesPoint[] | null;
    chart: 'line' | 'bar';
    labelKey: string;
    deepLink: string | null;
}

export interface MetricsPayload {
    window: Window;
    cards: MetricCardData[];
    latencies: TraceLatency[] | null;
    latencyDeepLink: string | null;
}

export async function fetchMetrics(window: Window): Promise<MetricsPayload> {
    const keys = Object.keys(METRICS) as MetricKey[];

    const cards = await Promise.all(keys.map(async (key): Promise<MetricCardData> => {
        const def = METRICS[key];
        const [series, priorTotal] = await Promise.all([
            getTimeSeries(key, window).catch(() => null),
            getPriorTotal(key, window).catch(() => 0),
        ]);
        const total = sumSeries(series);
        return {
            key,
            total,
            trend: computeTrend(total, priorTotal),
            series,
            chart: def.chart,
            labelKey: def.labelKey,
            deepLink: def.deepLinkFilter ? getAxiomDeepLinkUrl({ filter: def.deepLinkFilter }) : getAxiomDeepLinkUrl(),
        };
    }));

    const latencies = await getTraceLatencies(windowIso(window)).catch(() => null);

    return { window, cards, latencies, latencyDeepLink: getAxiomDeepLinkUrl() };
}
```

- [ ] **Step 7: Export from the actions barrel**

In `src/app/actions/index.ts`, add:

```ts
export { fetchMetrics } from './metrics';
export type { MetricsPayload, MetricCardData } from './metrics';
```

- [ ] **Step 8: Typecheck + reducer test**

Run: `npx tsc --noEmit && npx vitest run src/lib/metricsShape.test.ts`
Expected: no TS errors; reducer test PASS.

- [ ] **Step 9: Commit**

```bash
git add src/app/actions/metrics.ts src/app/actions/index.ts src/lib/axiom.ts src/lib/metricsShape.ts src/lib/metricsShape.test.ts
git commit -m "feat(metrics): fetchMetrics server action + prior-period totals"
```

---

## Task 5: SVG chart primitives

**Files:**
- Create: `src/components/charts/LineChart.tsx`, `src/components/charts/BarChart.tsx`, `src/components/charts/Sparkline.tsx`
- Test: `src/components/charts/charts.test.tsx`

**Interfaces:**
- Consumes: `SeriesPoint` (metricsSeries).
- Produces (all pure presentational, no client hooks — safe in server or client trees):
  - `LineChart({ points, color, height }: { points: SeriesPoint[]; color?: string; height?: number }): JSX.Element`
  - `BarChart({ points, color, height }: { points: SeriesPoint[]; color?: string; height?: number }): JSX.Element`
  - `Sparkline({ points, color }: { points: SeriesPoint[]; color?: string }): JSX.Element`

**Context:** charts render into a `viewBox="0 0 200 H"` with `preserveAspectRatio="none"` so they stretch responsively. Colors default to the theme teal `#0f766e`. A flat all-zero series must still render a baseline (no NaN in the path).

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/charts/charts.test.tsx
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LineChart } from './LineChart';
import { BarChart } from './BarChart';

const pts = [{ t: 1, value: 0 }, { t: 2, value: 5 }, { t: 3, value: 2 }];

describe('charts', () => {
    it('LineChart renders a polyline with one coord pair per point and no NaN', () => {
        const html = renderToStaticMarkup(<LineChart points={pts} />);
        expect(html).toContain('<polyline');
        expect(html).not.toContain('NaN');
        expect((html.match(/,/g) || []).length).toBeGreaterThanOrEqual(pts.length);
    });
    it('BarChart renders one rect per point', () => {
        const html = renderToStaticMarkup(<BarChart points={pts} />);
        expect((html.match(/<rect/g) || []).length).toBe(pts.length);
    });
    it('all-zero series renders without NaN', () => {
        const zero = [{ t: 1, value: 0 }, { t: 2, value: 0 }];
        expect(renderToStaticMarkup(<LineChart points={zero} />)).not.toContain('NaN');
        expect(renderToStaticMarkup(<BarChart points={zero} />)).not.toContain('NaN');
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/charts/charts.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the three charts**

```tsx
// src/components/charts/LineChart.tsx
import type { SeriesPoint } from '@/lib/metricsSeries';

const W = 200;
const DEFAULT_COLOR = '#0f766e';

export function LineChart({ points, color = DEFAULT_COLOR, height = 56 }: { points: SeriesPoint[]; color?: string; height?: number }) {
    const h = height;
    if (points.length === 0) return <svg viewBox={`0 0 ${W} ${h}`} className="w-full" style={{ height }} />;
    const max = Math.max(1, ...points.map(p => p.value));
    const stepX = points.length > 1 ? W / (points.length - 1) : 0;
    const y = (v: number) => h - 2 - (v / max) * (h - 4);
    const coords = points.map((p, i) => `${(i * stepX).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
    const last = points[points.length - 1];
    return (
        <svg viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img">
            <polyline fill="none" stroke={color} strokeWidth="2" points={coords} />
            <circle cx={(points.length - 1) * stepX} cy={y(last.value)} r="2.5" fill={color} />
        </svg>
    );
}
```

```tsx
// src/components/charts/BarChart.tsx
import type { SeriesPoint } from '@/lib/metricsSeries';

const W = 200;
const DEFAULT_COLOR = '#14b8a6';

export function BarChart({ points, color = DEFAULT_COLOR, height = 56 }: { points: SeriesPoint[]; color?: string; height?: number }) {
    const h = height;
    if (points.length === 0) return <svg viewBox={`0 0 ${W} ${h}`} className="w-full" style={{ height }} />;
    const max = Math.max(1, ...points.map(p => p.value));
    const slot = W / points.length;
    const bw = Math.max(1, slot * 0.7);
    return (
        <svg viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img">
            {points.map((p, i) => {
                const bh = (p.value / max) * (h - 4);
                const x = i * slot + (slot - bw) / 2;
                return <rect key={i} x={x.toFixed(1)} y={(h - bh).toFixed(1)} width={bw.toFixed(1)} height={bh.toFixed(1)} fill={color} />;
            })}
        </svg>
    );
}
```

```tsx
// src/components/charts/Sparkline.tsx
import type { SeriesPoint } from '@/lib/metricsSeries';
import { LineChart } from './LineChart';

export function Sparkline({ points, color }: { points: SeriesPoint[]; color?: string }) {
    return <LineChart points={points} color={color} height={28} />;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/charts/charts.test.tsx`
Expected: PASS. (If `renderToStaticMarkup`/JSX in vitest errors, ensure `vitest.config.ts` uses the `jsdom`/`react` environment already used by other `.test.tsx` files; if none exist, add `// @vitest-environment jsdom` at the top of the test.)

- [ ] **Step 5: Commit**

```bash
git add src/components/charts/
git commit -m "feat(metrics): hand-rolled SVG Line/Bar/Sparkline primitives"
```

---

## Task 6: MetricCard + MetricsDashboard client island

**Files:**
- Create: `src/components/admin/MetricCard.tsx`, `src/components/admin/MetricsDashboard.tsx`
- Test: none (covered by E2E in Task 9; components are thin glue)

**Interfaces:**
- Consumes: `MetricsPayload`, `MetricCardData`, `fetchMetrics` (actions); `LineChart`/`BarChart` (charts); `Window` (metricsTime); `useLanguage`/`t` (LanguageContext); `TraceLatency` (axiom).
- Produces: `MetricsDashboard({ initial }: { initial: MetricsPayload }): JSX.Element`

- [ ] **Step 1: Implement MetricCard**

```tsx
// src/components/admin/MetricCard.tsx
'use client';
import { useLanguage } from '@/context/LanguageContext';
import { LineChart } from '@/components/charts/LineChart';
import { BarChart } from '@/components/charts/BarChart';
import type { MetricCardData } from '@/app/actions/metrics';

export function MetricCard({ card, loading }: { card: MetricCardData; loading: boolean }) {
    const { t } = useLanguage();
    const trendColor = card.trend.dir === 'up' ? 'text-red-600' : card.trend.dir === 'down' ? 'text-emerald-600' : 'text-stone-500';
    const arrow = card.trend.dir === 'up' ? '▲' : card.trend.dir === 'down' ? '▼' : '—';
    const unavailable = card.series === null;
    return (
        <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm flex flex-col gap-2.5" aria-busy={loading}>
            <div className="flex items-start justify-between">
                <div>
                    <div className="text-[12.5px] text-stone-600 font-medium">{t(card.labelKey)}</div>
                    <div className="text-2xl font-semibold text-stone-900 leading-none mt-1">{unavailable ? '—' : card.total}</div>
                </div>
                {!unavailable && card.trend.pct !== null && (
                    <span className={`text-xs font-semibold ${trendColor}`}>{arrow} {Math.abs(card.trend.pct)}%</span>
                )}
            </div>
            {unavailable ? (
                <p className="text-xs text-stone-400 py-4">{t('admin.metric_unavailable')}</p>
            ) : card.chart === 'line' ? (
                <LineChart points={card.series!} />
            ) : (
                <BarChart points={card.series!} />
            )}
            <div className="flex justify-between items-center text-[11px] text-stone-500">
                <span>{t(`admin.metric_${card.key}_sub`)}</span>
                {card.deepLink && <a href={card.deepLink} target="_blank" rel="noopener noreferrer" className="text-teal-700 font-medium">{t('admin.metric_view_axiom')} →</a>}
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Implement MetricsDashboard**

```tsx
// src/components/admin/MetricsDashboard.tsx
'use client';
import { useState, useTransition } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { fetchMetrics, type MetricsPayload } from '@/app/actions/metrics';
import type { Window } from '@/lib/metricsTime';
import { MetricCard } from './MetricCard';

const OPS: string[] = ['errors', 'ai_failures', 'signin_failures'];
const WINDOWS: Window[] = ['24h', '7d', '30d'];

export function MetricsDashboard({ initial }: { initial: MetricsPayload }) {
    const { t } = useLanguage();
    const [data, setData] = useState(initial);
    const [window, setWindow] = useState<Window>(initial.window);
    const [pending, start] = useTransition();

    const pick = (w: Window) => {
        setWindow(w);
        start(async () => { setData(await fetchMetrics(w)); });
    };

    const ops = data.cards.filter(c => OPS.includes(c.key));
    const usage = data.cards.filter(c => !OPS.includes(c.key));

    return (
        <div>
            <div className="flex items-center justify-end gap-1.5 mb-5">
                {WINDOWS.map(w => (
                    <button key={w} onClick={() => pick(w)}
                        className={`px-3 py-1 rounded-full text-xs border ${window === w ? 'bg-teal-700 border-teal-700 text-white' : 'bg-white border-stone-300 text-stone-700'}`}>
                        {w}
                    </button>
                ))}
            </div>

            <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2.5">{t('admin.metrics_ops')}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {ops.map(c => <MetricCard key={c.key} card={c} loading={pending} />)}
                <LatencyCard latencies={data.latencies} deepLink={data.latencyDeepLink} />
            </div>

            <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mt-6 mb-2.5">{t('admin.metrics_usage')}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {usage.map(c => <MetricCard key={c.key} card={c} loading={pending} />)}
            </div>
        </div>
    );
}

function LatencyCard({ latencies, deepLink }: { latencies: MetricsPayload['latencies']; deepLink: string | null }) {
    const { t } = useLanguage();
    return (
        <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm flex flex-col gap-2">
            <div className="text-[12.5px] text-stone-600 font-medium">{t('admin.metric_latency')}</div>
            {latencies === null ? (
                <p className="text-xs text-stone-400 py-4">{t('admin.metric_unavailable')}</p>
            ) : (
                <div className="mt-0.5">
                    {latencies.slice(0, 4).map(l => (
                        <div key={l.trace} className="flex justify-between text-xs py-1 border-b border-dashed border-stone-200 last:border-0">
                            <span className="text-stone-600 truncate mr-2">{l.trace}</span>
                            <b className="text-stone-900">{l.p95} ms</b>
                        </div>
                    ))}
                </div>
            )}
            <div className="flex justify-between items-center text-[11px] text-stone-500 mt-auto">
                <span>p95 · {t('admin.metric_latency_sub')}</span>
                {deepLink && <a href={deepLink} target="_blank" rel="noopener noreferrer" className="text-teal-700 font-medium">{t('admin.metric_view_axiom')} →</a>}
            </div>
        </div>
    );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/MetricCard.tsx src/components/admin/MetricsDashboard.tsx
git commit -m "feat(metrics): MetricCard + MetricsDashboard client island"
```

---

## Task 7: `/admin/metrics` page (server component)

**Files:**
- Create: `src/app/admin/metrics/page.tsx`

**Interfaces:**
- Consumes: `fetchMetrics` (actions), `MetricsDashboard` (components).

- [ ] **Step 1: Implement the page**

```tsx
// src/app/admin/metrics/page.tsx
export const runtime = 'edge';

import { fetchMetrics } from '@/app/actions/metrics';
import { MetricsDashboard } from '@/components/admin/MetricsDashboard';

export default async function AdminMetricsPage() {
    const initial = await fetchMetrics('7d');
    return (
        <div className="max-w-6xl mx-auto">
            <header className="mb-5">
                <h2 className="text-2xl font-semibold text-stone-900">Métricas</h2>
                <p className="text-stone-500 text-sm">Salud y uso · datos de Axiom (caché 5&nbsp;min, por entorno)</p>
            </header>
            <MetricsDashboard initial={initial} />
        </div>
    );
}
```

(Admin gating is handled by `src/middleware.ts`, which already gates `/admin` — no per-page check needed, matching the other admin pages.)

- [ ] **Step 2: Build check**

Run: `npx tsc --noEmit && npm run lint`
Expected: no TS errors; lint warnings ≤ 125.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/metrics/page.tsx
git commit -m "feat(metrics): /admin/metrics server page with SSR default window"
```

---

## Task 8: Nav entry + i18n keys

**Files:**
- Modify: `src/components/AdminSidebar.tsx`
- Modify: `src/i18n/locales/es.ts`, `src/i18n/locales/en.ts`

- [ ] **Step 1: Add the nav item**

In `src/components/AdminSidebar.tsx`, insert into `NAV_ITEMS` right after the `/admin` overview entry (line ~9):

```ts
    { href: '/admin/metrics', labelKey: 'nav_metrics', icon: '📈' },
```

- [ ] **Step 2: Add es keys**

In `src/i18n/locales/es.ts`, inside the `admin:` object, add:

```ts
        nav_metrics: 'Métricas',
        metrics_ops: 'Salud operacional',
        metrics_usage: 'Uso del producto',
        metric_unavailable: 'No disponible',
        metric_view_axiom: 'Ver en Axiom',
        metric_errors: 'Errores',
        metric_errors_sub: 'nivel error',
        metric_ai_failures: 'Fallos de IA (Gemini)',
        metric_ai_failures_sub: 'extracción fallida',
        metric_signin_failures: 'Fallos de inicio de sesión',
        metric_signin_failures_sub: 'auth-error / next-auth',
        metric_active_rescuers: 'Rescatistas activos',
        metric_active_rescuers_sub: 'con actividad',
        metric_activity: 'Actividad registrada',
        metric_activity_sub: 'eventos con actor',
        metric_imports: 'Importaciones',
        metric_imports_sub: 'posts + planillas',
        metric_latency: 'Latencia por operación',
        metric_latency_sub: 'por traza',
```

- [ ] **Step 3: Add the SAME keys to en.ts**

In `src/i18n/locales/en.ts`, inside the `admin:` object, add:

```ts
        nav_metrics: 'Metrics',
        metrics_ops: 'Operational health',
        metrics_usage: 'Product usage',
        metric_unavailable: 'Unavailable',
        metric_view_axiom: 'View in Axiom',
        metric_errors: 'Errors',
        metric_errors_sub: 'error level',
        metric_ai_failures: 'AI failures (Gemini)',
        metric_ai_failures_sub: 'extraction failed',
        metric_signin_failures: 'Sign-in failures',
        metric_signin_failures_sub: 'auth-error / next-auth',
        metric_active_rescuers: 'Active rescuers',
        metric_active_rescuers_sub: 'with activity',
        metric_activity: 'Recorded activity',
        metric_activity_sub: 'events with an actor',
        metric_imports: 'Imports',
        metric_imports_sub: 'posts + spreadsheets',
        metric_latency: 'Latency by operation',
        metric_latency_sub: 'per trace',
```

- [ ] **Step 4: Verify no raw keys leak (typecheck + grep both locales have the keys)**

Run:
```bash
npx tsc --noEmit
grep -c "metric_errors\b" src/i18n/locales/es.ts src/i18n/locales/en.ts
```
Expected: no TS errors; each locale file reports `1`.

- [ ] **Step 5: Commit**

```bash
git add src/components/AdminSidebar.tsx src/i18n/locales/es.ts src/i18n/locales/en.ts
git commit -m "feat(metrics): admin nav entry + es/en i18n keys"
```

---

## Task 9: E2E test

**Files:**
- Create: `tests/admin-metrics.spec.ts`

**Context:** the repo runs Playwright with `authed` (admin), `user`, and `unauthed` projects. Node 26 blocks local Playwright (better-sqlite3) — write the spec, let CI run it. Match selectors to real rendered text (`Métricas`, the period buttons `24h`/`7d`/`30d`, and the section labels).

- [ ] **Step 1: Write the E2E spec**

```ts
// tests/admin-metrics.spec.ts
import { test, expect } from '@playwright/test';

test.describe('admin metrics dashboard', () => {
    test('admin sees the dashboard and can toggle the period', async ({ page }) => {
        await page.goto('/admin/metrics');
        await expect(page.getByRole('heading', { name: 'Métricas' })).toBeVisible();
        await expect(page.getByText('Salud operacional')).toBeVisible();
        await expect(page.getByText('Uso del producto')).toBeVisible();
        // toggle to 30d — the button becomes selected and the page doesn't crash
        await page.getByRole('button', { name: '30d', exact: true }).click();
        await expect(page.getByRole('button', { name: '30d', exact: true })).toHaveClass(/bg-teal-700/);
        // errors card label is present (metric renders whether Axiom returns data or "no disponible")
        await expect(page.getByText('Errores')).toBeVisible();
    });
});
```

Add the unauthed redirect assertion using the existing `unauthed` project pattern (mirror another admin spec in `tests/`):

```ts
test.describe('admin metrics — access', () => {
    test('unauthenticated is redirected away from /admin/metrics', async ({ page }) => {
        const res = await page.goto('/admin/metrics');
        // middleware redirects to sign-in; final URL is not the metrics page
        expect(page.url()).not.toContain('/admin/metrics');
        void res;
    });
});
```

Match the project config: put the first test under the `authed` project and the access test under `unauthed`. If the repo's specs select projects via file naming or `test.use`, follow that existing convention (check a sibling spec such as `tests/*admin*.spec.ts` before finalizing).

- [ ] **Step 2: Lint/typecheck the spec**

Run: `npx tsc --noEmit`
Expected: no errors. (Do not run Playwright locally — Node 26 blocks it; CI runs it.)

- [ ] **Step 3: Commit**

```bash
git add tests/admin-metrics.spec.ts
git commit -m "test(metrics): e2e for /admin/metrics load + period toggle + access"
```

---

## Task 10: Full-suite check + deploy prep

- [ ] **Step 1: Run the whole unit suite + typecheck + lint**

Run:
```bash
npm test
npx tsc --noEmit
npm run lint
```
Expected: all vitest green; no TS errors; lint warnings ≤ 125.

- [ ] **Step 2: Manual smoke against staging (after deploy)**

Follow `.agents/workflows/deploy.md`: bump version, commit, push to `staging`, wait for the green pipeline, then load `staging.../admin/metrics`:
- Confirm the seven cards render, the three period pills switch, and charts draw.
- Confirm "Ver en Axiom →" opens the dataset stream pre-filtered to the env.
- Confirm a broken metric (if any) shows "No disponible", not a crash.
- Cross-check one number (e.g. Errores 7d) against a direct Axiom query.

- [ ] **Step 3: Version bump + deploy commit**

```bash
npm version <next-version> --no-git-tag-version
git commit -am "v<next-version>: admin metrics dashboard (Axiom time-series charts)"
git push origin HEAD:staging
```

---

## Self-Review Notes

- **Spec coverage:** route (T7), data layer + gap-fill + cache-rounding (T1–T3), interactive control (T6), server action (T4), SVG charts (T5), 7-card metric set incl. sign-in failures (T3 registry + T6/T8), env-scoping (reuses `runQuery`), degradation (MetricCard + `.catch`), nav/i18n (T8), tests (T1–T5 vitest, T9 e2e). All covered.
- **External risk isolated:** the one unverifiable-locally assumption (Axiom `buckets.series` shape) is gated by Task 3 Step 7 before any UI depends on it.
- **Active-rescuers caveat:** the spec's distinct-count-per-bucket was simplified to an event-count proxy (`user != ''`) to avoid N-queries-per-bucket; if a true distinct trend is wanted later, it's an isolated change to `getTimeSeries` for that key. Flagged here so it's a conscious choice, not a silent gap.
- **Type consistency:** `Window`, `MetricKey`, `SeriesPoint`, `MetricsPayload`, `MetricCardData` names are used identically across T1–T9.
