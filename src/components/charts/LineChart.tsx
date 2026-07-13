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
