'use client';
export const runtime = 'edge';

import { useState } from 'react';
import { runAdminQuery } from '@/app/actions';

interface QueryMeta { changes?: number; rows_written?: number; rows_read?: number }

export default function AdminQueryPage() {
    const [query, setQuery] = useState('SELECT * FROM adopters LIMIT 5');
    const [result, setResult] = useState<Record<string, unknown>[] | null>(null);
    const [meta, setMeta] = useState<QueryMeta | null>(null);
    const [mutating, setMutating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [needsConfirm, setNeedsConfirm] = useState(false);
    const [loading, setLoading] = useState(false);

    const run = async (confirmed = false) => {
        setLoading(true); setError(null); setResult(null); setMeta(null); setNeedsConfirm(false);
        try {
            const data = await runAdminQuery(query, confirmed);
            if (data.needsConfirmation) {
                setNeedsConfirm(true);
            } else if (data.error) {
                setError(data.error);
            } else {
                setResult((data.rows ?? []) as Record<string, unknown>[]);
                setMeta((data.meta ?? null) as QueryMeta | null);
                setMutating(!!data.mutating);
            }
        } catch {
            setError('No se pudo ejecutar la consulta.');
        } finally {
            setLoading(false);
        }
    };

    const changes = meta?.changes ?? meta?.rows_written;

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            <header>
                <h2 className="text-2xl font-semibold text-stone-900">SQL Runner</h2>
                <p className="text-stone-500 text-sm">Ejecutá cualquier consulta (una sentencia por vez). Las que <b>modifican o borran datos</b> piden confirmación.</p>
            </header>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200 space-y-4">
                <textarea
                    className="w-full h-32 p-4 font-mono text-sm bg-stone-900 text-green-400 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500"
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setNeedsConfirm(false); }}
                    spellCheck={false}
                />
                <div className="flex justify-end">
                    <button
                        onClick={() => run(false)}
                        disabled={loading}
                        className="px-6 py-2 bg-teal-600 text-white font-semibold rounded-lg hover:bg-teal-700 disabled:opacity-50"
                    >
                        {loading ? 'Ejecutando…' : 'Ejecutar'}
                    </button>
                </div>
            </div>

            {needsConfirm && (
                <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl">
                    <div className="text-sm text-amber-900 font-semibold mb-1">⚠ Esta consulta modifica o borra datos.</div>
                    <div className="text-sm text-amber-800 mb-3">Revisá bien la sentencia antes de ejecutar — no hay deshacer.</div>
                    <div className="flex gap-2">
                        <button onClick={() => run(true)} disabled={loading} className="px-4 py-2 bg-rose-600 text-white font-semibold rounded-lg hover:bg-rose-700 disabled:opacity-50">
                            Sí, ejecutar
                        </button>
                        <button onClick={() => setNeedsConfirm(false)} className="px-4 py-2 text-stone-600 hover:bg-stone-100 rounded-lg">Cancelar</button>
                    </div>
                </div>
            )}

            {error && (
                <div className="p-4 bg-rose-50 text-rose-800 rounded-xl border border-rose-100 font-mono text-sm whitespace-pre-wrap">
                    {error}
                </div>
            )}

            {result && mutating && (
                <div className="p-4 bg-emerald-50 text-emerald-800 rounded-xl border border-emerald-100 text-sm">
                    ✔ Ejecutado. {changes != null ? `${changes} fila${changes === 1 ? '' : 's'} afectada${changes === 1 ? '' : 's'}.` : 'Sin conteo de filas.'}
                </div>
            )}

            {result && !mutating && (
                <div className="bg-white rounded-2xl shadow-sm border border-stone-200 overflow-x-auto">
                    {result.length === 0 ? (
                        <div className="p-8 text-center text-stone-500">Sin resultados.</div>
                    ) : (
                        <table className="w-full text-left text-sm">
                            <thead className="bg-stone-50 border-b border-stone-100">
                                <tr>
                                    {Object.keys(result[0]).map((key) => (
                                        <th key={key} className="p-3 font-semibold text-stone-600 whitespace-nowrap">{key}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-stone-100 font-mono">
                                {result.map((row, i) => (
                                    <tr key={i} className="hover:bg-stone-50/50">
                                        {Object.values(row).map((val, j) => (
                                            <td key={j} className="p-3 text-stone-600 whitespace-nowrap max-w-xs truncate">
                                                {val === null ? <span className="text-stone-300">null</span> : String(val)}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}
        </div>
    );
}
