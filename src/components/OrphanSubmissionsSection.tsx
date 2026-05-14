'use client';

/**
 * Admin section for /admin/users. Lists form_submissions whose
 * linked_adopter_id is null — i.e. submissions that never auto-created an
 * adopter (either predating Phase 1 / v2.14.10-18, or where the factory threw
 * at submit time and the route's try/catch let the form_submission persist
 * without a link).
 *
 * Each row has a "Vincular ahora" action that fires
 * /api/admin/orphan-submissions/[id]/retry — runs the same factory as the
 * live submit route + writes the link back.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useShowToast } from '@/components/ui/Toast';
import { formatShortDate } from '@/lib/dates';

interface Orphan {
    id: string;
    rescuerEmail: string;
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    status: string | null;
    createdAt: number | null;
    selectedAnimalId: string | null;
    selectedAnimalName: string | null;
}

export default function OrphanSubmissionsSection() {
    const toast = useShowToast();
    const [rows, setRows] = useState<Orphan[]>([]);
    const [loading, setLoading] = useState(true);
    const [retryingId, setRetryingId] = useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/admin/orphan-submissions');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json() as { submissions: Orphan[] };
            setRows(data.submissions ?? []);
        } catch (e) {
            toast.error('Error', e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const retry = async (id: string) => {
        if (retryingId) return;
        setRetryingId(id);
        try {
            const res = await fetch(`/api/admin/orphan-submissions/${id}/retry`, { method: 'POST' });
            const data = await res.json() as { success?: boolean; adopterId?: string; error?: string; dupCandidates?: number };
            if (!res.ok || !data.success) {
                toast.error('No se pudo vincular', data.error || 'Error desconocido');
                return;
            }
            const dupSuffix = data.dupCandidates ? ` — ${data.dupCandidates} posible(s) duplicado(s)` : '';
            toast.success('Vinculado', `Adoptante creado${dupSuffix}`);
            await load();
        } catch (e) {
            toast.error('Error', e instanceof Error ? e.message : String(e));
        } finally {
            setRetryingId(null);
        }
    };

    return (
        <section className="mt-10">
            <div className="flex items-center justify-between mb-3">
                <div>
                    <h2 className="text-xl font-semibold text-stone-900">📋 Respuestas sin vincular</h2>
                    <p className="text-stone-500 text-xs mt-0.5">
                        Form submissions con <code className="text-[11px] bg-stone-100 px-1 rounded">linked_adopter_id IS NULL</code>.
                        Triage de fallos del auto-create / submissions previas a Phase 1.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={load}
                    className="px-3 py-1.5 text-xs font-semibold text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-lg transition-colors"
                >
                    Refrescar
                </button>
            </div>

            {loading ? (
                <div className="p-4 text-stone-500 text-sm">Cargando...</div>
            ) : rows.length === 0 ? (
                <div className="p-4 text-stone-500 text-sm bg-white border border-stone-200 rounded-xl">
                    ✓ No hay respuestas sin vincular.
                </div>
            ) : (
                <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-stone-50 text-stone-600 text-xs uppercase tracking-wider">
                            <tr>
                                <th className="px-4 py-3 text-left">Fecha</th>
                                <th className="px-4 py-3 text-left">Respondente</th>
                                <th className="px-4 py-3 text-left">Rescatista</th>
                                <th className="px-4 py-3 text-left">Animal</th>
                                <th className="px-4 py-3 text-left">Estado</th>
                                <th className="px-4 py-3 text-left">Acción</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-100">
                            {rows.map(r => (
                                <tr key={r.id} className="hover:bg-stone-50/50 transition-colors">
                                    <td className="px-4 py-3 text-xs text-stone-500 whitespace-nowrap">
                                        {r.createdAt ? formatShortDate(r.createdAt) : '—'}
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="font-medium text-stone-900">{r.name}</div>
                                        <div className="text-xs text-stone-500 truncate max-w-[260px]">
                                            {[r.email, r.phone].filter(Boolean).join(' · ') || '—'}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-xs text-stone-700 truncate max-w-[200px]">{r.rescuerEmail}</td>
                                    <td className="px-4 py-3 text-xs text-stone-700">
                                        {r.selectedAnimalId ? (
                                            <Link href={`/animal/${r.selectedAnimalId}`} className="text-teal-700 hover:underline">
                                                {r.selectedAnimalName || r.selectedAnimalId.slice(0, 8)}
                                            </Link>
                                        ) : <span className="text-stone-400">—</span>}
                                    </td>
                                    <td className="px-4 py-3 text-xs">
                                        <span className="px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 font-medium">
                                            {r.status || 'pending'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-2">
                                            <Link
                                                href={`/form-results/${r.id}`}
                                                className="px-2.5 py-1 text-xs font-semibold text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-lg transition-colors"
                                            >
                                                Ver
                                            </Link>
                                            <button
                                                type="button"
                                                onClick={() => retry(r.id)}
                                                disabled={retryingId === r.id}
                                                className="px-2.5 py-1 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-600 disabled:opacity-50 rounded-lg transition-colors"
                                            >
                                                {retryingId === r.id ? 'Vinculando...' : 'Vincular ahora'}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}
