'use client';

import { useState } from 'react';
import type { DataQualityReport as ReportData } from '@/app/actions/dataQuality';
import PiiNotesPanel from './PiiNotesPanel';
import DuplicatesPanel from './DuplicatesPanel';
import ReportedContentPanel from './ReportedContentPanel';

export default function DataQualityReport({ data }: { data: ReportData }) {
    const [tab, setTab] = useState<'pii' | 'dup' | 'flags'>('pii');
    const [visitedDup, setVisitedDup] = useState(false);
    const [visitedFlags, setVisitedFlags] = useState(false);

    if (data.error) {
        return (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                No se pudo generar el reporte. {data.error === 'Unauthorized' ? 'No tenés permiso para verlo.' : `Código de error: ${data.error}`}
            </div>
        );
    }

    const selectTab = (id: 'pii' | 'dup' | 'flags') => {
        setTab(id);
        if (id === 'dup') setVisitedDup(true);
        if (id === 'flags') setVisitedFlags(true);
    };

    const TabBtn = ({ id, label, n }: { id: 'pii' | 'dup' | 'flags'; label: string; n?: number }) => (
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
                <TabBtn id="flags" label="Contenido reportado" />
            </div>

            {/* ── Tab 1: PII in notes (editable) ── */}
            {tab === 'pii' && <PiiNotesPanel rows={data.pii} />}

            {/* ── Tab 2: duplicate detection (lazy — mounts on first visit, stays mounted) ── */}
            {visitedDup && (
                <div className={tab === 'dup' ? '' : 'hidden'}>
                    <DuplicatesPanel />
                </div>
            )}

            {/* ── Tab 3: reported content / flags (lazy) ── */}
            {visitedFlags && (
                <div className={tab === 'flags' ? '' : 'hidden'}>
                    <ReportedContentPanel />
                </div>
            )}
        </div>
    );
}
