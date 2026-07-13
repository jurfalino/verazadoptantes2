import type { SeriesPoint } from '@/lib/metricsSeries';
import { LineChart } from './LineChart';

export function Sparkline({ points, color }: { points: SeriesPoint[]; color?: string }) {
    return <LineChart points={points} color={color} height={28} />;
}
