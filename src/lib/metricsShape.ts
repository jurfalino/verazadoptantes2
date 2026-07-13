import type { SeriesPoint } from './metricsSeries';

export function sumSeries(series: SeriesPoint[] | null): number {
    if (!series) return 0;
    return series.reduce((acc, p) => acc + p.value, 0);
}
