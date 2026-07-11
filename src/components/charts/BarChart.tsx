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
