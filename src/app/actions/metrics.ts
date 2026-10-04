'use server';

import { getTimeSeries, getPriorTotal, getWindowTotal, windowIso, getTraceLatencies, getTopErrors, getAxiomDeepLinkUrl, METRICS, type MetricKey, type TraceLatency } from '@/lib/axiom';
import { computeTrend, type Window } from '@/lib/metricsTime';
import { sumSeries } from '@/lib/metricsShape';
import type { SeriesPoint } from '@/lib/metricsSeries';
import { logger, generateErrorId } from '@/lib/logger';

/** Admin only: the dashboard is under /admin, and these read production
 *  metrics + error messages and spend the Axiom query quota. Throws with an
 *  errorId (the admin widgets already catch). */
async function assertAdmin(op: string): Promise<void> {
    let email: string | null = null;
    try {
        const { auth } = await import('@/auth');
        email = (await auth())?.user?.email ?? null;
    } catch { /* no session */ }
    const { isAdminAsync } = await import('@/config/admins');
    if (!email || !(await isAdminAsync(email))) {
        const errorId = generateErrorId();
        logger.warn(`${op}: refused — not an admin`, { user: email, errorId });
        throw new Error(`Unauthorized (Error ID: ${errorId})`);
    }
}

export interface MetricCardData {
    key: MetricKey;
    total: number;
    trend: { pct: number | null; dir: 'up' | 'down' | 'flat' };
    series: SeriesPoint[] | null;
    chart: 'line' | 'bar';
    labelKey: string;
    deepLink: string | null;
    higherIsBetter: boolean;
}

export interface MetricsPayload {
    window: Window;
    cards: MetricCardData[];
    latencies: TraceLatency[] | null;
    latencyDeepLink: string | null;
}

export async function fetchMetrics(window: Window): Promise<MetricsPayload> {
    await assertAdmin('fetchMetrics');
    const keys = Object.keys(METRICS) as MetricKey[];

    const cards = await Promise.all(keys.map(async (key): Promise<MetricCardData> => {
        const def = METRICS[key];
        const [series, priorTotal] = await Promise.all([
            getTimeSeries(key, window).catch((e) => {
                logger.warn('fetchMetrics: getTimeSeries failed', { key, window, error: e instanceof Error ? e.message : String(e) });
                return null;
            }),
            getPriorTotal(key, window).catch((e) => {
                logger.warn('fetchMetrics: getPriorTotal failed', { key, window, error: e instanceof Error ? e.message : String(e) });
                return 0;
            }),
        ]);
        // `distinct`-agg metrics (e.g. active_rescuers) must use a whole-window
        // total — summing the per-bucket distinct series over-counts a rescuer
        // active across multiple buckets. Count metrics keep the cheap summed
        // series total. The chart `series` itself is unaffected either way.
        const total = def.agg
            ? await getWindowTotal(key, window).catch((e) => {
                logger.warn('fetchMetrics: getWindowTotal failed', { key, window, error: e instanceof Error ? e.message : String(e) });
                return 0;
            })
            : sumSeries(series);
        return {
            key,
            total,
            trend: computeTrend(total, priorTotal),
            series,
            chart: def.chart,
            labelKey: def.labelKey,
            deepLink: def.deepLinkFilter ? getAxiomDeepLinkUrl({ filter: def.deepLinkFilter }) : getAxiomDeepLinkUrl(),
            higherIsBetter: METRICS[key].higherIsBetter ?? false,
        };
    }));

    const latencies = await getTraceLatencies(windowIso(window)).catch((e) => {
        logger.warn('fetchMetrics: getTraceLatencies failed', { window, error: e instanceof Error ? e.message : String(e) });
        return null;
    });

    return { window, cards, latencies, latencyDeepLink: getAxiomDeepLinkUrl() };
}

export interface TopErrorItem {
    message: string;
    count: number;
    /** Axiom deep-link filtered to this exact error message (null if unconfigured). */
    link: string | null;
}

export interface TopErrorsPayload {
    /** null = Axiom unavailable; [] = no errors in the window. */
    items: TopErrorItem[] | null;
    allLink: string | null;
}

/**
 * The one metrics widget the /admin/metrics dashboard doesn't have: the list of
 * the top error messages in the last 7 days (the dashboard only shows an error
 * COUNT). Fetched lazily alongside `fetchMetrics` when the Resumen "Métricas"
 * section is expanded, so nothing from the old eager overview block is lost.
 */
export async function fetchTopErrors7d(): Promise<TopErrorsPayload> {
    await assertAdmin('fetchTopErrors7d');
    const w = windowIso('7d');
    const raw = await getTopErrors({ ...w, limit: 5 }).catch((e) => {
        logger.warn('fetchTopErrors7d: getTopErrors failed', { error: e instanceof Error ? e.message : String(e) });
        return null;
    });
    const items = raw == null ? null : raw.map((e) => {
        const escaped = e.message.replace(/"/g, '\\"');
        return { message: e.message, count: e.count, link: getAxiomDeepLinkUrl({ filter: `level=="error" message=="${escaped}"` }) };
    });
    return { items, allLink: getAxiomDeepLinkUrl({ filter: 'level=="error"' }) };
}
