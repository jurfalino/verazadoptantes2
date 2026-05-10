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

interface AxiomAggregation {
    op: string;
    field?: string;
    argument?: number[];
}

interface AxiomFilter {
    op: string;
    field: string;
    value: string | number;
}

interface AxiomQueryBody {
    startTime: string;
    endTime: string;
    aggregations: AxiomAggregation[];
    filter?: AxiomFilter;
    groupBy?: string[];
}

interface AxiomQueryResponse {
    buckets?: {
        totals?: Array<{
            group: Record<string, string | null>;
            aggregations: Array<{ op: string; value: number | number[] | null }>;
        }>;
    };
}

async function runQuery(body: AxiomQueryBody, config: AxiomConfig): Promise<AxiomQueryResponse | null> {
    const cacheKey = JSON.stringify(body);
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
        body: JSON.stringify(body),
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

/** Distinct rescuers (the `user` field — set by findAdopters and similar
 *  authenticated read paths). Note: this is "active searchers" not "all
 *  active accounts" since some events use `changedBy` / `userEmail` instead.
 *  Phase 2 could union these fields; v1 keeps it simple.
 */
export async function getActiveRescuers(w: TimeWindow): Promise<number | null> {
    const config = getQueryConfig();
    if (!config) return null;
    const data = await runQuery({
        startTime: w.startTime,
        endTime: w.endTime,
        aggregations: [{ op: 'distinct', field: 'user' }],
    }, config);
    const total = data?.buckets?.totals?.[0]?.aggregations?.[0]?.value;
    return typeof total === 'number' ? total : 0;
}
