export const runtime = 'edge';
import { getDb } from "@/app/actions";
import { adopters, adoptions, adopterFlags } from "@/db/schema";
import { count, isNull } from "drizzle-orm";
import AdminDangerZone from "@/components/AdminDangerZone";
import { getErrorsCount, getTopErrors, getTraceLatencies, getActiveRescuers } from "@/lib/axiom";

export default async function AdminOverviewPage() {
    const db = await getDb();
    if (!db) return <div>Database unavailable</div>;

    // Time windows for Axiom metrics. Last 7d is the primary window; prior 7d
    // (i.e. 14d ago → 7d ago) gives us the delta arrow on the errors counter.
    const now = new Date();
    const iso = (d: Date) => d.toISOString();
    const win7 = { startTime: iso(new Date(now.getTime() - 7 * 86400000)), endTime: iso(now) };
    const winPrior7 = { startTime: iso(new Date(now.getTime() - 14 * 86400000)), endTime: iso(new Date(now.getTime() - 7 * 86400000)) };
    const win30 = { startTime: iso(new Date(now.getTime() - 30 * 86400000)), endTime: iso(now) };

    // All fetches in parallel. Axiom helpers each `.catch(() => null)` so one
    // failure (or missing AXIOM_QUERY_TOKEN) degrades that section instead of
    // crashing the whole page — same pattern as v2.14.9-1's adopter page hardening.
    const [
        adopterCount,
        adoptionCount,
        activeFlagsCount,
        errorsThis7d,
        errorsPrior7d,
        topErrors,
        traceLatencies,
        activeRescuers7d,
        activeRescuers30d,
    ] = await Promise.all([
        db.select({ count: count() }).from(adopters).where(isNull(adopters.deletedAt)),
        db.select({ count: count() }).from(adoptions),
        db.select({ count: count() }).from(adopterFlags),
        getErrorsCount(win7).catch(() => null),
        getErrorsCount(winPrior7).catch(() => null),
        getTopErrors({ ...win7, limit: 5 }).catch(() => null),
        getTraceLatencies(win7).catch(() => null),
        getActiveRescuers(win7).catch(() => null),
        getActiveRescuers(win30).catch(() => null),
    ]);

    const stats = [
        { label: 'Total Adopters', value: adopterCount[0].count, color: 'emerald' },
        { label: 'Recorded Adoptions', value: adoptionCount[0].count, color: 'blue' },
        { label: 'Active Flags', value: activeFlagsCount[0].count, color: 'rose' },
    ];

    // Error trend: ↓ (improvement) when this7d < prior7d, ↑ (regression) when greater.
    const errorTrend: 'down' | 'up' | 'flat' | null =
        errorsThis7d == null || errorsPrior7d == null
            ? null
            : errorsThis7d < errorsPrior7d ? 'down'
                : errorsThis7d > errorsPrior7d ? 'up'
                    : 'flat';

    // If every Axiom helper returned null, the entire metrics section degrades
    // to a single "no disponible" placeholder rather than rendering 0s everywhere.
    const metricsAvailable = errorsThis7d != null || topErrors != null || traceLatencies != null || activeRescuers7d != null;

    return (
        <div className="max-w-6xl mx-auto space-y-8">
            <header>
                <h2 className="text-3xl font-semibold text-stone-900">Dashboard Overview</h2>
                <p className="text-stone-500 mt-2">Welcome back, Admin.</p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {stats.map((stat) => (
                    <div key={stat.label} className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
                        <p className={`text-sm font-semibold uppercase tracking-wider text-${stat.color}-600/70 mb-2`}>
                            {stat.label}
                        </p>
                        <p className="text-4xl font-extrabold text-stone-900">
                            {stat.value}
                        </p>
                    </div>
                ))}
            </div>

            {/* Métricas (últimos 7 días) — replaces the v2.14.8 "Activity Log
                coming soon..." placeholder. Backed by Axiom; degrades gracefully
                when AXIOM_QUERY_TOKEN is unset (local dev) or the API is down. */}
            <section className="space-y-4">
                <div className="flex items-baseline justify-between">
                    <h3 className="text-xl font-semibold text-stone-900">Métricas (últimos 7 días)</h3>
                    {metricsAvailable && (
                        <span className="text-xs text-stone-500">
                            cache 5min · datos de Axiom
                        </span>
                    )}
                </div>

                {!metricsAvailable ? (
                    <div className="bg-white p-8 rounded-2xl shadow-sm border border-stone-200 text-center text-stone-500">
                        <p>Métricas no disponibles.</p>
                        <p className="text-xs mt-2 text-stone-400">
                            Configurá <code className="bg-stone-100 px-1 py-0.5 rounded">AXIOM_QUERY_TOKEN</code> en Cloudflare Pages para activarlas.
                        </p>
                    </div>
                ) : (
                    <>
                        {/* Counters row: errors + active 7d + active 30d */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
                                <p className="text-sm font-semibold uppercase tracking-wider text-rose-600/70 mb-2">
                                    Errores 7d
                                </p>
                                <div className="flex items-baseline gap-3">
                                    <p className="text-4xl font-extrabold text-stone-900">
                                        {errorsThis7d ?? '—'}
                                    </p>
                                    {errorTrend && errorsThis7d != null && errorsPrior7d != null && (
                                        <span className={`text-sm font-semibold ${errorTrend === 'down' ? 'text-emerald-600' : errorTrend === 'up' ? 'text-rose-600' : 'text-stone-500'}`}>
                                            {errorTrend === 'down' ? '↓' : errorTrend === 'up' ? '↑' : '·'} vs {errorsPrior7d}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
                                <p className="text-sm font-semibold uppercase tracking-wider text-teal-600/70 mb-2">
                                    Activos 7d
                                </p>
                                <p className="text-4xl font-extrabold text-stone-900">
                                    {activeRescuers7d ?? '—'}
                                </p>
                                <p className="text-xs text-stone-500 mt-1">rescatistas (búsquedas)</p>
                            </div>
                            <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
                                <p className="text-sm font-semibold uppercase tracking-wider text-teal-600/70 mb-2">
                                    Activos 30d
                                </p>
                                <p className="text-4xl font-extrabold text-stone-900">
                                    {activeRescuers30d ?? '—'}
                                </p>
                                <p className="text-xs text-stone-500 mt-1">rescatistas (búsquedas)</p>
                            </div>
                        </div>

                        {/* Top errors table */}
                        <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
                            <h4 className="text-sm font-semibold text-stone-900 mb-3">Top errores 7d</h4>
                            {topErrors == null ? (
                                <p className="text-sm text-stone-500">No disponible.</p>
                            ) : topErrors.length === 0 ? (
                                <p className="text-sm text-emerald-700">Ningún error registrado en los últimos 7 días. ✓</p>
                            ) : (
                                <ul className="divide-y divide-stone-100">
                                    {topErrors.map((e) => (
                                        <li key={e.message} className="py-2 flex items-start justify-between gap-4">
                                            <span className="text-sm text-stone-700 leading-snug">{e.message}</span>
                                            <span className="text-sm font-semibold text-rose-700 flex-shrink-0">{e.count}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>

                        {/* Trace latency table */}
                        <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200">
                            <h4 className="text-sm font-semibold text-stone-900 mb-3">Latencia por traza (p50 / p95)</h4>
                            {traceLatencies == null ? (
                                <p className="text-sm text-stone-500">No disponible.</p>
                            ) : traceLatencies.length === 0 ? (
                                <p className="text-sm text-stone-500">Sin datos de trazas en los últimos 7 días.</p>
                            ) : (
                                <ul className="divide-y divide-stone-100">
                                    {traceLatencies.map((t) => (
                                        <li key={t.trace} className="py-2 flex items-center justify-between gap-4">
                                            <span className="text-sm text-stone-700 font-mono">{t.trace}</span>
                                            <span className="text-sm text-stone-600 flex-shrink-0">
                                                <span className="font-semibold text-stone-800">{t.p50}ms</span> / <span className="font-semibold text-stone-800">{t.p95}ms</span>
                                                <span className="text-stone-400 ml-2">· {t.count.toLocaleString()} calls</span>
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </>
                )}
            </section>

            {/* Danger Zone */}
            <AdminDangerZone />
        </div>
    );
}
