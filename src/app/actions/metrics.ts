'use server';

import { getTimeSeries, getPriorTotal, getWindowTotal, windowIso, getTraceLatencies, getAxiomDeepLinkUrl, METRICS, type MetricKey, type TraceLatency } from '@/lib/axiom';
import { computeTrend, type Window } from '@/lib/metricsTime';
import { sumSeries } from '@/lib/metricsShape';
import type { SeriesPoint } from '@/lib/metricsSeries';
import { logger } from '@/lib/logger';

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
        };
    }));

    const latencies = await getTraceLatencies(windowIso(window)).catch((e) => {
        logger.warn('fetchMetrics: getTraceLatencies failed', { window, error: e instanceof Error ? e.message : String(e) });
        return null;
    });

    return { window, cards, latencies, latencyDeepLink: getAxiomDeepLinkUrl() };
}
