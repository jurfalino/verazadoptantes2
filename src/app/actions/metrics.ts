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
