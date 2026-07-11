'use client';
import { useState, useTransition, useRef } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { fetchMetrics, type MetricsPayload } from '@/app/actions/metrics';
import type { Window } from '@/lib/metricsTime';
import { MetricCard } from './MetricCard';

const OPS: string[] = ['errors', 'ai_failures', 'signin_failures'];
const WINDOWS: Window[] = ['24h', '7d', '30d'];

export function MetricsDashboard({ initial }: { initial: MetricsPayload }) {
    const { t } = useLanguage();
    const [data, setData] = useState(initial);
    const [period, setPeriod] = useState<Window>(initial.window);
    const [pending, start] = useTransition();
    const reqIdRef = useRef(0);

    const pick = (w: Window) => {
        setPeriod(w);
        const id = ++reqIdRef.current;
        start(async () => {
            const payload = await fetchMetrics(w);
            if (reqIdRef.current === id) setData(payload);
        });
    };

    const ops = data.cards.filter(c => OPS.includes(c.key));
    const usage = data.cards.filter(c => !OPS.includes(c.key));

    return (
        <div>
            <div className="flex items-center justify-end gap-1.5 mb-5">
                {WINDOWS.map(w => (
                    <button key={w} onClick={() => pick(w)}
                        className={`px-3 py-1 rounded-full text-xs border ${period === w ? 'bg-teal-700 border-teal-700 text-white' : 'bg-white border-stone-300 text-stone-700'}`}>
                        {w}
                    </button>
                ))}
            </div>

            <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2.5">{t('admin.metrics_ops')}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {ops.map(c => <MetricCard key={c.key} card={c} loading={pending} />)}
                <LatencyCard latencies={data.latencies} deepLink={data.latencyDeepLink} />
            </div>

            <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mt-6 mb-2.5">{t('admin.metrics_usage')}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {usage.map(c => <MetricCard key={c.key} card={c} loading={pending} />)}
            </div>
        </div>
    );
}

function LatencyCard({ latencies, deepLink }: { latencies: MetricsPayload['latencies']; deepLink: string | null }) {
    const { t } = useLanguage();
    return (
        <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm flex flex-col gap-2">
            <div className="text-[12.5px] text-stone-600 font-medium">{t('admin.metric_latency')}</div>
            {latencies === null ? (
                <p className="text-xs text-stone-400 py-4">{t('admin.metric_unavailable')}</p>
            ) : (
                <div className="mt-0.5">
                    {latencies.slice(0, 4).map(l => (
                        <div key={l.trace} className="flex justify-between text-xs py-1 border-b border-dashed border-stone-200 last:border-0">
                            <span className="text-stone-600 truncate mr-2">{l.trace}</span>
                            <b className="text-stone-900">{l.p95} ms</b>
                        </div>
                    ))}
                </div>
            )}
            <div className="flex justify-between items-center text-[11px] text-stone-500 mt-auto">
                <span>p95 · {t('admin.metric_latency_sub')}</span>
                {deepLink && <a href={deepLink} target="_blank" rel="noopener noreferrer" className="text-teal-700 font-medium">{t('admin.metric_view_axiom')} →</a>}
            </div>
        </div>
    );
}
