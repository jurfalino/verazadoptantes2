'use client';

import { useEffect, useState, useCallback } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { formatShortDate } from '@/lib/dates';
import { listDeletedAdopters, restoreAdopter, purgeAdopter, purgeDeletedAdopters } from '@/app/actions';

interface DeletedRow {
    id: string;
    name: string | null;
    addedBy: string | null;
    country: string | null;
    deletedAt: Date | number | null;
    tokenHash: string | null;
}

/**
 * /admin/deleted — the "Papelera". One place to manage every soft-deleted
 * adopter (merged duplicates AND deletion-request soft-deletes): restore, or
 * purge permanently — one by one or all at once. v2.20.0.
 */
export default function AdminDeletedPage() {
    const { locale } = useLanguage();
    const isEs = locale === 'es';
    const toast = useShowToast();

    const [rows, setRows] = useState<DeletedRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        const res = await listDeletedAdopters();
        if (res.ok) setRows(res.rows as DeletedRow[]);
        else toast.error(isEs ? 'Error' : 'Error', res.error || 'Failed to load', res.errorId);
        setSelected(new Set());
        setLoading(false);
    }, [isEs, toast]);

    useEffect(() => { load(); }, [load]);

    const reasonLabel = (h: string | null) =>
        h === 'MERGED' ? (isEs ? 'Fusionado' : 'Merged')
            : h === 'DELETED' ? (isEs ? 'Eliminación solicitada' : 'Deletion request')
                : (isEs ? 'Eliminado' : 'Deleted');

    const toggle = (id: string) => setSelected(s => {
        const n = new Set(s);
        if (n.has(id)) n.delete(id); else n.add(id);
        return n;
    });
    const allSelected = rows.length > 0 && selected.size === rows.length;
    const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map(r => r.id)));

    const doRestore = async (id: string) => {
        setBusy(true);
        const res = await restoreAdopter(id);
        if (res.ok) { toast.success('✓', isEs ? 'Registro restaurado' : 'Record restored'); await load(); }
        else toast.error(isEs ? 'Error' : 'Error', res.error || 'Failed to restore', res.errorId);
        setBusy(false);
    };

    const doPurge = async (id: string, name: string | null) => {
        const label = name || id;
        if (!confirm(isEs
            ? `¿Purgar definitivamente "${label}"? Esta acción es irreversible.`
            : `Permanently purge "${label}"? This cannot be undone.`)) return;
        setBusy(true);
        const res = await purgeAdopter(id);
        if (res.success) { toast.success('✓', isEs ? 'Registro purgado' : 'Record purged'); await load(); }
        else toast.error(isEs ? 'Error' : 'Error', res.error || 'Failed to purge');
        setBusy(false);
    };

    const doPurgeBulk = async (all: boolean) => {
        const ids = all ? [] : Array.from(selected);
        const n = all ? rows.length : ids.length;
        if (n === 0) return;
        if (!confirm(isEs
            ? `¿Purgar definitivamente ${n} registro(s)? Esta acción es irreversible.`
            : `Permanently purge ${n} record(s)? This cannot be undone.`)) return;
        setBusy(true);
        const res = await purgeDeletedAdopters(ids);
        if (res.ok) { toast.success('✓', isEs ? `${res.purged} purgado(s)` : `${res.purged} purged`); await load(); }
        else toast.error(isEs ? 'Error' : 'Error', res.error || 'Failed to purge', res.errorId);
        setBusy(false);
    };

    return (
        <div className="max-w-5xl mx-auto space-y-5">
            <div>
                <h2 className="text-2xl font-semibold text-stone-900">🗑️ {isEs ? 'Eliminados (Papelera)' : 'Deleted (Trash)'}</h2>
                <p className="text-stone-500 text-sm mt-1">
                    {isEs
                        ? 'Registros ocultos por fusión o por solicitud de eliminación. Restauralos o purgalos definitivamente.'
                        : 'Records hidden by merge or deletion request. Restore them, or purge permanently.'}
                </p>
            </div>

            {/* Bulk actions */}
            <div className="flex flex-wrap items-center gap-2 text-sm">
                <button onClick={toggleAll} disabled={!rows.length}
                    className="px-2.5 py-1.5 rounded-lg bg-stone-100 text-stone-600 hover:bg-stone-200 disabled:opacity-40">
                    {allSelected ? (isEs ? 'Deseleccionar' : 'Deselect all') : (isEs ? 'Seleccionar todo' : 'Select all')}
                </button>
                <button onClick={() => doPurgeBulk(false)} disabled={busy || !selected.size}
                    className="px-2.5 py-1.5 rounded-lg bg-rose-600 text-white font-semibold hover:bg-rose-500 disabled:opacity-40">
                    🗑 {isEs ? `Purgar seleccionados (${selected.size})` : `Purge selected (${selected.size})`}
                </button>
                <button onClick={() => doPurgeBulk(true)} disabled={busy || !rows.length}
                    className="px-2.5 py-1.5 rounded-lg bg-rose-700 text-white font-semibold hover:bg-rose-600 disabled:opacity-40">
                    🗑 {isEs ? 'Purgar todo' : 'Purge all'}
                </button>
            </div>

            {loading ? (
                <div className="p-8 text-center text-stone-500 text-sm">{isEs ? 'Cargando...' : 'Loading...'}</div>
            ) : rows.length === 0 ? (
                <div className="bg-white rounded-2xl border border-stone-200 p-10 text-center text-stone-500 text-sm">
                    {isEs ? 'No hay registros eliminados. ✅' : 'No deleted records. ✅'}
                </div>
            ) : (
                <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden divide-y divide-stone-100">
                    {rows.map(r => (
                        <div key={r.id} className="flex items-center gap-3 px-4 py-3 hover:bg-stone-50/60">
                            <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)}
                                className="w-4 h-4 accent-teal-600 flex-shrink-0"
                                aria-label={isEs ? `Seleccionar ${r.name || r.id}` : `Select ${r.name || r.id}`} />
                            <div className="min-w-0 flex-1">
                                <div className="font-semibold text-stone-900 text-sm truncate">{r.name || r.id}</div>
                                <div className="text-xs text-stone-500 flex flex-wrap gap-x-2 items-center">
                                    <span className="inline-flex px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 font-medium">{reasonLabel(r.tokenHash)}</span>
                                    {r.deletedAt ? <span>{formatShortDate(new Date(r.deletedAt))}</span> : null}
                                    {r.addedBy ? <span className="truncate">· {r.addedBy}</span> : null}
                                </div>
                            </div>
                            <button onClick={() => doRestore(r.id)} disabled={busy}
                                className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-100 disabled:opacity-40 flex-shrink-0">
                                ↩ {isEs ? 'Restaurar' : 'Restore'}
                            </button>
                            <button onClick={() => doPurge(r.id, r.name)} disabled={busy}
                                className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-40 flex-shrink-0">
                                🗑 {isEs ? 'Purgar' : 'Purge'}
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
