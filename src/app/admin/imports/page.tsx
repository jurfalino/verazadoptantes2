'use client';

import { useEffect, useState } from 'react';
import { getImportRuns, getImportRunItems } from '@/app/actions';
import { formatDateTimeFull } from '@/lib/dates';

interface ImportRun {
    id: string; actorEmail: string | null; source: string | null; total: number | null;
    createdCount: number | null; updatedCount: number | null; skippedCount: number | null; failedCount: number | null;
    status: string; startedAt: Date | number | string | null; finishedAt: Date | number | string | null;
}
interface ImportRunItem {
    id: string; runId: string; rowIndex: number | null; adopterId: string | null; adopterName: string | null;
    action: string | null; status: string | null; matchedAdopterId: string | null; matchedAdopterName: string | null;
    matchConfidence: number | null; message: string | null;
}

const ACTION_LABEL: Record<string, string> = { create: 'Crear', upsert: 'Actualizar', skip: 'Omitir' };
const STATUS_STYLE: Record<string, string> = {
    created: 'bg-emerald-50 text-emerald-700', updated: 'bg-sky-50 text-sky-700',
    skipped: 'bg-amber-50 text-amber-700', failed: 'bg-rose-50 text-rose-700',
};

export default function AdminImportsPage() {
    const [runs, setRuns] = useState<ImportRun[]>([]);
    const [loading, setLoading] = useState(true);
    const [expanded, setExpanded] = useState<string | null>(null);
    const [items, setItems] = useState<Record<string, ImportRunItem[]>>({});
    const [loadingItems, setLoadingItems] = useState<string | null>(null);

    useEffect(() => {
        getImportRuns()
            .then(r => setRuns(r as unknown as ImportRun[]))
            .catch(() => setRuns([]))
            .finally(() => setLoading(false));
    }, []);

    const toggle = async (runId: string) => {
        if (expanded === runId) { setExpanded(null); return; }
        setExpanded(runId);
        if (!items[runId]) {
            setLoadingItems(runId);
            try {
                const it = await getImportRunItems(runId);
                setItems(prev => ({ ...prev, [runId]: it as unknown as ImportRunItem[] }));
            } catch { setItems(prev => ({ ...prev, [runId]: [] })); }
            finally { setLoadingItems(null); }
        }
    };

    return (
        <div className="max-w-5xl mx-auto px-4 py-6">
            <h1 className="text-2xl font-extrabold text-stone-900 mb-1">Importaciones</h1>
            <p className="text-sm text-stone-500 mb-6">Cada corrida de importación de planillas: quién, cuándo, y qué registros creó o actualizó (con el registro que matcheó y la acción tomada).</p>

            {loading ? (
                <div className="text-sm text-stone-500">Cargando…</div>
            ) : runs.length === 0 ? (
                <div className="text-sm text-stone-500">Todavía no hay importaciones registradas.</div>
            ) : (
                <div className="space-y-2">
                    {runs.map(run => (
                        <div key={run.id} className="border border-stone-200 rounded-xl overflow-hidden">
                            <button onClick={() => toggle(run.id)} aria-expanded={expanded === run.id}
                                className="w-full text-left px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1 hover:bg-stone-50">
                                <span className="text-stone-400">{expanded === run.id ? '▾' : '▸'}</span>
                                <span className="font-medium text-stone-800">{run.actorEmail || '—'}</span>
                                <span className="text-sm text-stone-500">{formatDateTimeFull(run.startedAt ?? '')}</span>
                                {run.source && <span className="text-xs text-stone-400 truncate max-w-[220px]" title={run.source}>· {run.source}</span>}
                                {run.status === 'running'
                                    ? <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">en curso</span>
                                    : <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">completa</span>}
                                <span className="ml-auto text-xs text-stone-500 flex gap-2">
                                    <span className="text-emerald-700">{run.createdCount ?? 0} creados</span>
                                    {(run.updatedCount ?? 0) > 0 && <span className="text-sky-700">{run.updatedCount} actualizados</span>}
                                    {(run.skippedCount ?? 0) > 0 && <span className="text-amber-700">{run.skippedCount} omitidos</span>}
                                    {(run.failedCount ?? 0) > 0 && <span className="text-rose-700">{run.failedCount} fallidos</span>}
                                    <span className="text-stone-400">de {run.total ?? 0}</span>
                                </span>
                            </button>
                            {expanded === run.id && (
                                <div className="border-t border-stone-100 bg-stone-50/50">
                                    {loadingItems === run.id ? (
                                        <div className="px-4 py-3 text-sm text-stone-500">Cargando registros…</div>
                                    ) : (items[run.id]?.length ?? 0) === 0 ? (
                                        <div className="px-4 py-3 text-sm text-stone-500">{run.status === 'running' ? 'Corrida en curso o interrumpida — sin registros guardados aún.' : 'Sin registros.'}</div>
                                    ) : (
                                        <div className="max-h-96 overflow-y-auto">
                                            {items[run.id].map(it => (
                                                <div key={it.id} className="px-4 py-1.5 text-sm border-t border-stone-100 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                                    <span className="text-stone-400 w-10 flex-shrink-0">#{it.rowIndex ?? '—'}</span>
                                                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 flex-shrink-0">{ACTION_LABEL[it.action ?? ''] ?? it.action ?? '—'}</span>
                                                    <span className="font-medium text-stone-800 min-w-0 truncate">
                                                        {it.adopterId
                                                            ? <a href={`/adopter/${it.adopterId}`} target="_blank" rel="noopener noreferrer" className="text-teal-700 hover:underline">{it.adopterName?.trim() || 'Sin nombre'}</a>
                                                            : (it.adopterName?.trim() || <span className="italic text-stone-400">Sin nombre</span>)}
                                                    </span>
                                                    {it.status && <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0 ${STATUS_STYLE[it.status] ?? 'bg-stone-100 text-stone-500'}`}>{it.status}</span>}
                                                    {it.matchedAdopterId && (
                                                        <span className="text-xs text-stone-500 flex-shrink-0">
                                                            → matcheó <a href={`/adopter/${it.matchedAdopterId}`} target="_blank" rel="noopener noreferrer" className="text-teal-700 hover:underline">{it.matchedAdopterName?.trim() || 'registro'}</a>
                                                            {it.matchConfidence != null && <span className="text-stone-400"> ({it.matchConfidence}%)</span>}
                                                        </span>
                                                    )}
                                                    {it.message && <span className="text-xs text-stone-400 min-w-0 truncate">· {it.message}</span>}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
