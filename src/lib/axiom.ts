/**
 * Axiom query-side helper — counterpart to logger.ts (which is ingest-side).
 *
 * Used by /admin landing to surface aggregate metrics from the same logs we
 * already write. Read-only; uses a separate token (AXIOM_QUERY_TOKEN) with
 * query scope, distinct from AXIOM_TOKEN (ingest scope, used by logger.ts).
 *
 * Endpoint contract (verified against the live API May 2026):
 * - POST /v1/datasets/{dataset}/query?legacy=true
 * - Body: { startTime, endTime, aggregations[], filter?, groupBy?, ... }
 * - Field names are FLAT in the query body (`level`, `message`, `trace`,
 *   `duration`, `user`) even though the events are stored nested under `data.*`
 *   in the JSON. This is an Axiom legacy-API quirk.
 * - Results in `body.buckets.totals[]` with shape:
 *     { group: { field: value }, aggregations: [{ op, value }] }
 *
 * In-memory cache (5-min TTL, per-worker) makes repeat /admin loads cheap.
 * Cold start = 4 parallel API calls = ~300-500ms. After that, instant for 5min.
 */

import { getRequestContext } from '@cloudflare/next-on-pages';
import { windowToBucket, bucketStartsMs, windowRangeIso, type Window } from './metricsTime';
import { mapSeriesToPoints, type SeriesPoint } from './metricsSeries';

const AXIOM_API = 'https://api.axiom.co/v1/datasets';
const CACHE_TTL_MS = 5 * 60 * 1000;

interface AxiomConfig {
    dataset: string;
    token: string;
}

function getQueryConfig(): AxiomConfig | null {
    let dataset = '';
    let token = '';
    try {
        const { env } = getRequestContext();
        const e = env as unknown as Record<string, string | undefined>;
        dataset = e?.AXIOM_DATASET || process.env.AXIOM_DATASET || '';
        token = e?.AXIOM_QUERY_TOKEN || process.env.AXIOM_QUERY_TOKEN || '';
    } catch {
        dataset = process.env.AXIOM_DATASET || '';
        token = process.env.AXIOM_QUERY_TOKEN || '';
    }
    if (!dataset || !token) return null;
    return { dataset, token };
}

// Module-level cache. Per-worker, resets on cold start. Keyed by stringified body.
const _cache = new Map<string, { value: unknown; expiresAt: number }>();

/** Detect the current deploy environment, mirroring `logger.ts`'s ingest-side
 *  shape so the values line up with what's stored in Axiom events. Returns
 *  one of: 'production', 'staging', 'preview-<branch>', or 'local'. Used to
 *  scope every metric query to the env it's running in — staging /admin
 *  shouldn't see production traffic and vice versa.
 */
function getCurrentEnv(): string {
    let branch: string | undefined;
    let url: string | undefined;
    try {
        const { env } = getRequestContext();
        const e = env as unknown as Record<string, string | undefined>;
        branch = e?.CF_PAGES_BRANCH || process.env.CF_PAGES_BRANCH;
        url = e?.CF_PAGES_URL || process.env.CF_PAGES_URL;
    } catch {
        branch = process.env.CF_PAGES_BRANCH;
        url = process.env.CF_PAGES_URL;
    }
    if (branch === 'master' || branch === 'main') return 'production';
    if (branch === 'staging' || url?.includes('staging')) return 'staging';
    if (branch) return `preview-${branch}`;
    return 'local';
}

export interface AxiomAggregation {
    op: string;
    field?: string;
    argument?: number[];
}

interface AxiomLeafFilter {
    op: string;
    field: string;
    value: string | number;
}

interface AxiomCompoundFilter {
    op: 'and' | 'or';
    children: AxiomFilter[];
}

type AxiomFilter = AxiomLeafFilter | AxiomCompoundFilter;

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

async function runQuery(body: AxiomQueryBody, config: AxiomConfig): Promise<AxiomQueryResponse | null> {
    // Auto-inject an env filter so /admin metrics on staging only see staging
    // events (and prod sees prod). The logger ingest-side stamps every event
    // with `env` via getEnvironmentInfo() in logger.ts; we mirror that field
    // here. Verified against the live API: compound { op:'and', children:[...] }
    // filters work in the legacy structured query endpoint.
    const envFilter: AxiomLeafFilter = { op: '==', field: 'env', value: getCurrentEnv() };
    const finalFilter: AxiomFilter = body.filter
        ? { op: 'and', children: [body.filter, envFilter] }
        : envFilter;
    const finalBody: AxiomQueryBody = { ...body, filter: finalFilter };

    const cacheKey = JSON.stringify(finalBody);
    const cached = _cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.value as AxiomQueryResponse;
    }

    const url = `${AXIOM_API}/${encodeURIComponent(config.dataset)}/query?legacy=true`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${config.token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(finalBody),
    });
    if (!res.ok) {
        // Don't crash the admin page on Axiom failure. Caller treats null as
        // "metrics unavailable" and degrades the section gracefully.
        return null;
    }
    const data = await res.json() as AxiomQueryResponse;
    _cache.set(cacheKey, { value: data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
}

// ── Metric registry + time series ──────────────────────────────────────────

export type MetricKey = 'errors' | 'ai_failures' | 'signin_failures' | 'active_rescuers' | 'activity' | 'imports';

export interface MetricDef {
    key: MetricKey;
    labelKey: string;
    chart: 'line' | 'bar';
    filter?: AxiomFilter;
    deepLinkFilter?: string;
    agg?: AxiomAggregation; // defaults to count(*); active_rescuers uses distinct(user)
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

// ── Typed metric wrappers ─────────────────────────────────────────────────

interface TimeWindow {
    startTime: string;
    endTime: string;
}

/** Total error count in the window. Returns null if Axiom is unavailable. */
export async function getErrorsCount(w: TimeWindow): Promise<number | null> {
    const config = getQueryConfig();
    if (!config) return null;
    const data = await runQuery({
        startTime: w.startTime,
        endTime: w.endTime,
        aggregations: [{ op: 'count', field: '*' }],
        filter: { op: '==', field: 'level', value: 'error' },
    }, config);
    const total = data?.buckets?.totals?.[0]?.aggregations?.[0]?.value;
    return typeof total === 'number' ? total : 0;
}

export interface TopError {
    message: string;
    count: number;
}

/** Top errors by message in the window, sorted descending by count. */
export async function getTopErrors(w: TimeWindow & { limit?: number }): Promise<TopError[] | null> {
    const config = getQueryConfig();
    if (!config) return null;
    const data = await runQuery({
        startTime: w.startTime,
        endTime: w.endTime,
        aggregations: [{ op: 'count', field: '*' }],
        filter: { op: '==', field: 'level', value: 'error' },
        groupBy: ['message'],
    }, config);
    const totals = data?.buckets?.totals || [];
    const rows: TopError[] = totals
        .map((r) => ({
            message: typeof r.group?.message === 'string' ? r.group.message : '(empty)',
            count: typeof r.aggregations?.[0]?.value === 'number' ? r.aggregations[0].value : 0,
        }))
        .filter((r) => r.count > 0)
        .sort((a, b) => b.count - a.count);
    return rows.slice(0, w.limit ?? 5);
}

export interface TraceLatency {
    trace: string;
    p50: number;
    p95: number;
    count: number;
}

/** p50/p95 + call count for each named trace (`findAdopters.discovery` etc). */
export async function getTraceLatencies(w: TimeWindow): Promise<TraceLatency[] | null> {
    const config = getQueryConfig();
    if (!config) return null;
    const data = await runQuery({
        startTime: w.startTime,
        endTime: w.endTime,
        aggregations: [
            { op: 'count', field: '*' },
            { op: 'percentiles', field: 'duration', argument: [50, 95] },
        ],
        groupBy: ['trace'],
    }, config);
    const totals = data?.buckets?.totals || [];
    const rows: TraceLatency[] = [];
    for (const r of totals) {
        const trace = r.group?.trace;
        // Skip the catch-all "no trace" bucket — events without a trace field
        // shouldn't show up as a latency row.
        if (!trace || typeof trace !== 'string') continue;
        const count = typeof r.aggregations?.[0]?.value === 'number' ? r.aggregations[0].value : 0;
        const pct = r.aggregations?.[1]?.value;
        if (Array.isArray(pct) && pct.length >= 2 && typeof pct[0] === 'number' && typeof pct[1] === 'number') {
            rows.push({ trace, p50: Math.round(pct[0]), p95: Math.round(pct[1]), count });
        }
    }
    return rows.sort((a, b) => b.count - a.count);
}

/** Distinct active rescuers in the window — counts unique email-shaped
 *  values across every actor field we log under (`user`, `changedBy`,
 *  `email`, `userEmail`). Logging field-name inconsistency is real codebase
 *  debt; the long-term fix is to standardize on a single `actorEmail`
 *  field in the logger. Until then this union covers all activity types
 *  (search, profile-create, adoption-record, sign-in, my-animals query).
 *
 *  Implementation: 4 parallel groupBy queries, each returning the distinct
 *  values of one field. Union client-side, dedup case-insensitive, drop
 *  sentinel non-emails ("anonymous", "unknown", "system").
 */
export async function getActiveRescuers(w: TimeWindow): Promise<number | null> {
    const config = getQueryConfig();
    if (!config) return null;
    const FIELDS = ['user', 'changedBy', 'email', 'userEmail'];
    const results = await Promise.all(FIELDS.map((field) =>
        runQuery({
            startTime: w.startTime,
            endTime: w.endTime,
            aggregations: [{ op: 'count', field: '*' }],
            groupBy: [field],
        }, config).catch(() => null)
    ));
    // If every query failed (token / network), bubble up null so the caller
    // renders "no disponible" instead of a misleading 0.
    if (results.every((r) => r === null)) return null;
    const set = new Set<string>();
    for (let i = 0; i < results.length; i++) {
        const totals = results[i]?.buckets?.totals || [];
        const fieldName = FIELDS[i];
        for (const r of totals) {
            const v = r.group?.[fieldName];
            if (typeof v !== 'string' || !v) continue;
            const normalized = v.toLowerCase().trim();
            if (normalized === 'anonymous' || normalized === 'unknown' || normalized === 'system') continue;
            // Loose email shape check — drops accidental non-email values
            if (!normalized.includes('@')) continue;
            set.add(normalized);
        }
    }
    return set.size;
}

// ── Deep-link helper ──────────────────────────────────────────────────────

/** Optional filter expression for the Axiom Stream view. */
export interface DeepLinkOptions {
    /** Raw filter expression in Axiom's stream search syntax (e.g. `level=="error"`). */
    filter?: string;
}

/** Build a URL into the Axiom UI for the configured dataset. Returns null
 *  when `AXIOM_ORG_SLUG` is not set so callers can hide the link gracefully.
 *  Used by /admin landing to give "Ver en Axiom →" affordances on each metric.
 *
 *  URL shape: `https://app.axiom.co/{org}/datasets/{dataset}/stream` — opens
 *  the Stream view scoped to the dataset. Optional `filter` is appended as
 *  `?_q=` so Axiom pre-applies a simple filter expression
 *  (e.g. `level=="error"` or `trace=="findAdopters.discovery"`).
 */
export function getAxiomDeepLinkUrl(opts: DeepLinkOptions = {}): string | null {
    let slug = '';
    let dataset = '';
    try {
        const { env } = getRequestContext();
        const e = env as unknown as Record<string, string | undefined>;
        slug = e?.AXIOM_ORG_SLUG || process.env.AXIOM_ORG_SLUG || '';
        dataset = e?.AXIOM_DATASET || process.env.AXIOM_DATASET || '';
    } catch {
        slug = process.env.AXIOM_ORG_SLUG || '';
        dataset = process.env.AXIOM_DATASET || '';
    }
    if (!slug || !dataset) return null;
    const base = `https://app.axiom.co/${encodeURIComponent(slug)}/datasets/${encodeURIComponent(dataset)}/stream`;
    // Always env-scope the deep-link so clicking from /admin doesn't show
    // cross-env events (mirrors the auto env filter on the metric queries).
    const envFilter = `env=="${getCurrentEnv()}"`;
    const combined = opts.filter ? `${envFilter} ${opts.filter}` : envFilter;
    return `${base}?_q=${encodeURIComponent(combined)}`;
}
