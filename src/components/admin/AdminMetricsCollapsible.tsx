'use client';

import { useState, useTransition } from 'react';
import { fetchMetrics, fetchTopErrors7d, type MetricsPayload, type TopErrorsPayload } from '@/app/actions/metrics';
import { MetricsDashboard } from './MetricsDashboard';

/**
 * Resumen "Métricas" section — the /admin/metrics dashboard, folded into the
 * overview page under a collapsible that only hits Axiom when expanded (so the
 * overview itself loads fast, off the DB counters alone). First expansion
 * lazy-fetches the dashboard payload + the top-errors list once and caches it;
 * the dashboard's own 24h/7d/30d toggle re-fetches from there.
 */
export default function AdminMetricsCollapsible() {
    const [open, setOpen] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [failed, setFailed] = useState(false);
    const [pending, start] = useTransition();
    const [metrics, setMetrics] = useState<MetricsPayload | null>(null);
    const [topErrors, setTopErrors] = useState<TopErrorsPayload | null>(null);

    const toggle = () => {
        const next = !open;
        setOpen(next);
        if (next && !loaded && !pending) {
            start(async () => {
                try {
                    const [m, te] = await Promise.all([fetchMetrics('7d'), fetchTopErrors7d()]);
                    setMetrics(m);
                    setTopErrors(te);
                    setLoaded(true);
                } catch {
                    setFailed(true);
                }
            });
        }
    };

    return (
        <section className="bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden">
            <button
                onClick={toggle}
                aria-expanded={open}
                className="w-full flex items-center justify-between gap-3 px-6 py-4 text-left hover:bg-stone-50 transition-colors"
            >
                <h3 className="text-xl font-semibold text-stone-900">Métricas</h3>
                <span className="flex items-center gap-2.5 text-xs text-stone-500">
                    <span className="hidden sm:inline">últimos 7 días · datos de Axiom</span>
                    <svg className={`w-5 h-5 text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                </span>
            </button>

            {open && (
                <div className="px-6 pb-6 pt-5 border-t border-stone-100">
                    {failed ? (
                        <p className="text-sm text-stone-500 py-6 text-center">No se pudieron cargar las métricas.</p>
                    ) : !loaded ? (
                        <div className="flex items-center gap-3 text-sm text-stone-500 py-10 justify-center">
                            <svg className="w-5 h-5 animate-spin text-teal-600" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
                            </svg>
                            Cargando métricas…
                        </div>
                    ) : metrics ? (
                        <>
                            <MetricsDashboard initial={metrics} />
                            <TopErrorsList data={topErrors} />
                        </>
                    ) : null}
                </div>
            )}
        </section>
    );
}

function TopErrorsList({ data }: { data: TopErrorsPayload | null }) {
    return (
        <div className="mt-6 bg-stone-50 border border-stone-200 rounded-2xl p-5">
            <div className="flex items-baseline justify-between gap-3 mb-3">
                <h4 className="text-sm font-semibold text-stone-900">Top errores (7 días)</h4>
                {data?.allLink && (
                    <a href={data.allLink} target="_blank" rel="noopener noreferrer" className="text-xs text-teal-700 hover:text-teal-800 font-medium underline underline-offset-2">
                        Ver en Axiom →
                    </a>
                )}
            </div>
            {data == null || data.items == null ? (
                <p className="text-sm text-stone-500">No disponible.</p>
            ) : data.items.length === 0 ? (
                <p className="text-sm text-emerald-700">Ningún error registrado en los últimos 7 días. ✓</p>
            ) : (
                <ul className="divide-y divide-stone-200">
                    {data.items.map((e) => (
                        <li key={e.message} className="py-2 flex items-start justify-between gap-4">
                            {e.link ? (
                                <a href={e.link} target="_blank" rel="noopener noreferrer" className="text-sm text-stone-700 leading-snug hover:text-teal-700 hover:underline" title="Ver eventos en Axiom">
                                    {e.message}
                                </a>
                            ) : (
                                <span className="text-sm text-stone-700 leading-snug">{e.message}</span>
                            )}
                            <span className="text-sm font-semibold text-rose-700 flex-shrink-0">{e.count}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
