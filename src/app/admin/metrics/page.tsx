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
