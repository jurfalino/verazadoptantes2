'use client';
export const runtime = 'edge';

import { useState } from 'react';
import { runAdminQuery } from '@/app/actions'; // Need to implement this

export default function AdminQueryPage() {
    const [query, setQuery] = useState('SELECT * FROM adopters LIMIT 5');
    const [result, setResult] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const handleRun = async () => {
        setLoading(true);
        setError(null);
        setResult(null);
        try {
            const data = await runAdminQuery(query);
            if (data.error) {
                setError(data.error);
            } else {
                setResult(data.rows);
            }
        } catch (e) {
            setError('Failed to run query');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            <header>
                <h2 className="text-2xl font-bold text-stone-900">SQL Runner</h2>
                <p className="text-stone-500 text-sm">Execute read-only queries. Be careful.</p>
            </header>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-200 space-y-4">
                <textarea
                    className="w-full h-32 p-4 font-mono text-sm bg-stone-900 text-green-400 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    spellCheck={false}
                />
                <div className="flex justify-end">
                    <button
                        onClick={handleRun}
                        disabled={loading}
                        className="px-6 py-2 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                    >
                        {loading ? 'Running...' : 'Run Query'}
                    </button>
                </div>
            </div>

            {error && (
                <div className="p-4 bg-rose-50 text-rose-800 rounded-xl border border-rose-100 font-mono text-sm">
                    {error}
                </div>
            )}

            {result && (
                <div className="bg-white rounded-2xl shadow-sm border border-stone-200 overflow-x-auto">
                    {result.length === 0 ? (
                        <div className="p-8 text-center text-stone-500">No results found.</div>
                    ) : (
                        <table className="w-full text-left text-sm">
                            <thead className="bg-stone-50 border-b border-stone-100">
                                <tr>
                                    {Object.keys(result[0]).map((key) => (
                                        <th key={key} className="p-3 font-bold text-stone-600 whitespace-nowrap">{key}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-stone-100 font-mono">
                                {result.map((row: any, i: number) => (
                                    <tr key={i} className="hover:bg-stone-50/50">
                                        {Object.values(row).map((val: any, j: number) => (
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
