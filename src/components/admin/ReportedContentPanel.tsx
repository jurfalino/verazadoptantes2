'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { getReportedFlags, type ReportedFlagRow } from '@/app/actions/dataQuality';
import { dismissFlag } from '@/app/actions/flags';
import { formatShortDate } from '@/lib/dates';
import { adopterDisplayName } from '@/lib/adopterDisplay';

/**
 * "Contenido reportado" tab of Calidad de datos — the user-flag review moved
 * from /admin/flags (v2.44.3). Lazy-fetches all flags, filters by reason
 * (default 'duplicate') with a per-reason count, and dismisses via the
 * admin-only dismissFlag action (moderators can view but not dismiss).
 */

const NAMELESS_LABEL = 'No name';
const ALL = '__all__';

const REASON_META: Record<string, { label: string; cls: string }> = {
    duplicate: { label: 'Duplicado', cls: 'bg-amber-100 text-amber-800' },
    inaccurate_information: { label: 'Información inexacta', cls: 'bg-amber-100 text-amber-800' },
    verified_identity: { label: 'Identidad verificada', cls: 'bg-emerald-100 text-emerald-800' },
    verified_address: { label: 'Dirección verificada', cls: 'bg-emerald-100 text-emerald-800' },
    dangerous: { label: 'Peligroso', cls: 'bg-rose-100 text-rose-800' },
};
const metaFor = (r: string) => REASON_META[r] ?? { label: r, cls: 'bg-stone-100 text-stone-700' };

export default function ReportedContentPanel() {
    const [flags, setFlags] = useState<ReportedFlagRow[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [reason, setReason] = useState<string>('duplicate'); // preselected
    const [dismissing, setDismissing] = useState<string | null>(null);
    const [, start] = useTransition();

    useEffect(() => {
        let alive = true;
        start(async () => {
            const res = await getReportedFlags();
            if (!alive) return;
            if (res.error) setError(res.error);
            else setFlags(res.flags);
        });
        return () => { alive = false; };
    }, []);

    // Per-reason counts for the filter options (computed from the full set).
    const counts = useMemo(() => {
        const m = new Map<string, number>();
        for (const f of flags ?? []) m.set(f.reason, (m.get(f.reason) ?? 0) + 1);
        return m;
    }, [flags]);

    const options = useMemo(() => {
        // Stable order: known reasons first (in FLAG_REASONS-ish order), then any extras.
        const known = ['duplicate', 'inaccurate_information', 'verified_identity', 'verified_address', 'dangerous'];
        const present = Array.from(counts.keys());
        const ordered = [...known.filter(r => counts.has(r)), ...present.filter(r => !known.includes(r))];
        return ordered;
    }, [counts]);

    const visible = useMemo(() => {
        if (!flags) return [];
        return reason === ALL ? flags : flags.filter(f => f.reason === reason);
    }, [flags, reason]);

    async function handleDismiss(id: string) {
        if (!confirm('¿Descartar este reporte?')) return;
        setDismissing(id);
        const prev = flags;
        setFlags(f => (f ? f.filter(x => x.id !== id) : f)); // optimistic
        try {
            await dismissFlag(id);
        } catch (e) {
            setFlags(prev ?? null); // restore on failure
            alert(e instanceof Error ? e.message : 'No se pudo descartar el reporte.');
        } finally {
            setDismissing(null);
        }
    }

    if (error) {
        return (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                No se pudo cargar el contenido reportado. {error === 'Unauthorized' ? 'No tenés permiso.' : `Código: ${error}`}
            </div>
        );
    }

    if (flags === null) {
        return <div className="text-center py-10 text-stone-500 text-sm">Cargando reportes…</div>;
    }

    const total = flags.length;

    return (
        <div className="space-y-4">
            {/* Reason filter — each option shows its total count */}
            <div className="flex gap-2 flex-wrap items-center">
                <span className="text-xs font-semibold uppercase tracking-wider text-stone-400 mr-1">Motivo</span>
                <FilterPill label="Todos" count={total} active={reason === ALL} onClick={() => setReason(ALL)} />
                {options.map(r => (
                    <FilterPill key={r} label={metaFor(r).label} count={counts.get(r) ?? 0} active={reason === r} onClick={() => setReason(r)} />
                ))}
            </div>

            {visible.length === 0 ? (
                <div className="bg-white p-10 text-center rounded-2xl border border-stone-200 text-stone-500 text-sm">
                    {total === 0 ? 'No hay contenido reportado. ✓' : `Sin reportes con el motivo seleccionado.`}
                </div>
            ) : (
                <>
                    {/* Desktop table */}
                    <div className="hidden md:block bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden">
                        <table className="w-full text-left">
                            <thead className="bg-stone-50 border-b border-stone-100">
                                <tr>
                                    <th className="p-4 font-semibold text-stone-500 text-sm">Adoptante</th>
                                    <th className="p-4 font-semibold text-stone-500 text-sm">Motivo</th>
                                    <th className="p-4 font-semibold text-stone-500 text-sm">Detalle</th>
                                    <th className="p-4 font-semibold text-stone-500 text-sm">Reportó</th>
                                    <th className="p-4 font-semibold text-stone-500 text-sm text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-stone-100">
                                {visible.map(flag => {
                                    const m = metaFor(flag.reason);
                                    return (
                                        <tr key={flag.id} className="hover:bg-stone-50/50">
                                            <td className="p-4">
                                                <div className="font-semibold text-stone-900">{flag.adopterFound ? adopterDisplayName({ name: flag.adopterName }, NAMELESS_LABEL) : 'Desconocido'}</div>
                                                <div className="text-xs text-stone-500 font-mono">{flag.adopterId}</div>
                                            </td>
                                            <td className="p-4">
                                                <span className={`inline-flex px-2 py-1 rounded-full text-xs font-semibold ${m.cls}`}>{m.label}</span>
                                            </td>
                                            <td className="p-4 text-sm text-stone-600 max-w-xs truncate" title={flag.details || ''}>{flag.details || '-'}</td>
                                            <td className="p-4 text-xs text-stone-500">
                                                {flag.flaggedBy}<br />
                                                {flag.createdAt ? formatShortDate(new Date(flag.createdAt)) : ''}
                                            </td>
                                            <td className="p-4 text-right space-x-2 whitespace-nowrap">
                                                <a href={`/adopter/${flag.adopterId}`} target="_blank" className="px-3 py-1.5 text-xs font-semibold text-stone-600 bg-stone-100 rounded-lg hover:bg-stone-200">Ver</a>
                                                <button
                                                    onClick={() => handleDismiss(flag.id)}
                                                    disabled={dismissing === flag.id}
                                                    className="px-3 py-1.5 text-xs font-semibold text-white bg-teal-700 rounded-lg hover:bg-teal-600 shadow-sm disabled:opacity-50"
                                                >
                                                    Descartar
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {/* Mobile cards */}
                    <div className="md:hidden space-y-3">
                        {visible.map(flag => {
                            const m = metaFor(flag.reason);
                            return (
                                <div key={flag.id} className="bg-white rounded-xl p-4 shadow-sm border border-stone-200">
                                    <div className="flex items-start justify-between gap-2 mb-2">
                                        <div className="min-w-0">
                                            <div className="font-semibold text-stone-900 truncate">{flag.adopterFound ? adopterDisplayName({ name: flag.adopterName }, NAMELESS_LABEL) : 'Desconocido'}</div>
                                            <div className="text-xs text-stone-500 font-mono truncate">{flag.adopterId}</div>
                                        </div>
                                        <span className={`inline-flex px-2 py-1 rounded-full text-xs font-semibold flex-shrink-0 ${m.cls}`}>{m.label}</span>
                                    </div>
                                    {flag.details && <p className="text-sm text-stone-600 mb-2">{flag.details}</p>}
                                    <div className="text-xs text-stone-500 mb-3">{flag.flaggedBy} · {flag.createdAt ? formatShortDate(new Date(flag.createdAt)) : ''}</div>
                                    <div className="flex gap-2">
                                        <a href={`/adopter/${flag.adopterId}`} target="_blank" className="flex-1 text-center px-3 py-2 text-xs font-semibold text-stone-600 bg-stone-100 rounded-lg hover:bg-stone-200">Ver</a>
                                        <button
                                            onClick={() => handleDismiss(flag.id)}
                                            disabled={dismissing === flag.id}
                                            className="flex-1 px-3 py-2 text-xs font-semibold text-white bg-teal-700 rounded-lg hover:bg-teal-600 shadow-sm disabled:opacity-50"
                                        >
                                            Descartar
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );
}

function FilterPill({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                active ? 'bg-teal-600 border-teal-600 text-white' : 'bg-white border-stone-300 text-stone-600 hover:border-teal-400'
            }`}
        >
            {label} <span className={active ? 'text-white/80' : 'text-stone-400'}>({count})</span>
        </button>
    );
}
