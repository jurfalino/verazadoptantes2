'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { DataQualityReport as ReportData, PiiNoteRow } from '@/app/actions/dataQuality';
import DuplicatesPanel from './DuplicatesPanel';

// Accent-insensitive, case-insensitive normalization for the search box.
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export default function DataQualityReport({ data }: { data: ReportData }) {
    const [tab, setTab] = useState<'pii' | 'dup'>('pii');
    const [visitedDup, setVisitedDup] = useState(false);
    const [q, setQ] = useState('');
    const nq = norm(q.trim());

    const pii = useMemo<PiiNoteRow[]>(() => {
        if (!nq) return data.pii;
        return data.pii.filter(r => norm(r.name).includes(nq) || norm(r.note).includes(nq));
    }, [data.pii, nq]);

    const piiTotals = useMemo(() => data.pii.reduce((acc, r) => {
        if (r.hasPhone) acc.phone++;
        if (r.hasSocial) acc.social++;
        if (r.hasAddress) acc.address++;
        return acc;
    }, { phone: 0, social: 0, address: 0 }), [data.pii]);

    if (data.error) {
        return (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                No se pudo generar el reporte. {data.error === 'Unauthorized' ? 'No tenés permiso para verlo.' : `Código de error: ${data.error}`}
            </div>
        );
    }

    const selectTab = (id: 'pii' | 'dup') => {
        setTab(id);
        if (id === 'dup') setVisitedDup(true);
    };

    const TabBtn = ({ id, label, n }: { id: 'pii' | 'dup'; label: string; n?: number }) => (
        <button
            onClick={() => selectTab(id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-t-lg text-sm font-semibold border-b-2 -mb-px transition-colors ${
                tab === id ? 'text-stone-900 border-teal-600' : 'text-stone-500 border-transparent hover:text-stone-700'
            }`}
        >
            {label}
            {n !== undefined && (
                <span className={`text-[11px] font-bold rounded-full px-2 py-px ${tab === id ? 'bg-teal-600 text-white' : 'bg-stone-200 text-stone-500'}`}>{n}</span>
            )}
        </button>
    );

    return (
        <div>
            {/* Tabs */}
            <div className="flex gap-1 border-b border-stone-200 mb-4 flex-wrap">
                <TabBtn id="pii" label="Contacto en notas" n={data.pii.length} />
                <TabBtn id="dup" label="Duplicados" />
            </div>

            {/* ── Tab 1: PII in notes ── */}
            {tab === 'pii' && (
                <>
                    <div className="flex items-center gap-3 mb-4 flex-wrap">
                        <div className="relative flex-1 min-w-[180px]">
                            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <circle cx="11" cy="11" r="8" strokeWidth={2} /><path strokeLinecap="round" strokeWidth={2} d="m21 21-4.3-4.3" />
                            </svg>
                            <input
                                value={q}
                                onChange={e => setQ(e.target.value)}
                                placeholder="Buscar por nombre o contenido de la nota…"
                                className="w-full pl-9 pr-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500"
                            />
                        </div>
                        <span className="text-xs text-stone-500">
                            {`${data.pii.length} registros · 📞 ${piiTotals.phone} · 🔗 ${piiTotals.social} · 📍 ${piiTotals.address}`}
                        </span>
                    </div>

                    {pii.length === 0 ? <Empty q={q} clean="Sin registros con contacto en las notas. 🎉" />
                    : <div className="space-y-2.5">
                        {pii.map(r => (
                            <div key={r.adopterId} className="bg-white border border-stone-200 rounded-xl p-4 flex gap-4 items-start">
                                <div className="min-w-0 flex-1">
                                    <Link href={`/adopter/${r.adopterId}`} target="_blank" className="font-semibold text-[15px] text-stone-900 hover:text-teal-700 hover:underline">
                                        {r.name || <span className="italic text-stone-400">Sin nombre</span>}
                                    </Link>
                                    <div className="flex gap-1.5 flex-wrap my-1.5">
                                        {r.hasPhone && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200">📞 Teléfono</span>}
                                        {r.hasSocial && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">🔗 Social</span>}
                                        {r.hasAddress && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">📍 Dirección</span>}
                                    </div>
                                    <p className="text-[13px] text-stone-500 bg-stone-50 border border-stone-200 rounded-lg px-2.5 py-1.5 line-clamp-2 whitespace-pre-wrap">{r.note}</p>
                                </div>
                                <Link href={`/adopter/${r.adopterId}`} target="_blank" className="flex-shrink-0 text-xs font-semibold px-3 py-2 rounded-lg bg-teal-600 text-white hover:bg-teal-700 whitespace-nowrap">
                                    Abrir ficha ↗
                                </Link>
                            </div>
                        ))}
                    </div>}
                </>
            )}

            {/* ── Tab 2: duplicate detection (lazy — mounts on first visit, stays mounted) ── */}
            {visitedDup && (
                <div className={tab === 'dup' ? '' : 'hidden'}>
                    <DuplicatesPanel />
                </div>
            )}
        </div>
    );
}

function Empty({ q, clean }: { q: string; clean: string }) {
    return (
        <div className="text-center text-sm text-stone-500 bg-white border border-stone-200 rounded-xl py-10">
            {q.trim() ? `Sin resultados para “${q.trim()}”.` : clean}
        </div>
    );
}
