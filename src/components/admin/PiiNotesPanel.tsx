'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { updateEventDetails, dismissPiiNote, undismissPiiNote, type PiiNoteRow } from '@/app/actions/dataQuality';
import { detectNotePii, noteHasPii } from '@/domain/notePii';
import { useShowToast } from '@/components/ui/Toast';

// Accent-insensitive, case-insensitive normalization for the search box.
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * "Contacto en notas" tab — one row per PII-bearing activity note, editable in
 * place so an admin/mod can strip the contact info and save without leaving the
 * page. Each row edits its own adopter_events.details (via updateEventDetails).
 */
export default function PiiNotesPanel({ rows }: { rows: PiiNoteRow[] }) {
    const toast = useShowToast();
    const [items, setItems] = useState<PiiNoteRow[]>(rows);
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState<string | null>(null);
    const [q, setQ] = useState('');
    const [vis, setVis] = useState<'all' | 'protected'>('all');
    const nq = norm(q.trim());

    const protectedCount = useMemo(() => items.filter(r => r.isProtected).length, [items]);

    const visible = useMemo(() => {
        return items.filter(r => {
            if (vis === 'protected' && !r.isProtected) return false;
            if (nq && !(norm(r.name).includes(nq) || norm(r.note).includes(nq))) return false;
            return true;
        });
    }, [items, nq, vis]);

    const totals = useMemo(() => items.reduce((a, r) => {
        if (r.hasPhone) a.phone++;
        if (r.hasSocial) a.social++;
        if (r.hasAddress) a.address++;
        return a;
    }, { phone: 0, social: 0, address: 0 }), [items]);

    const draftFor = (r: PiiNoteRow) => drafts[r.eventId] ?? r.note;
    const isDirty = (r: PiiNoteRow) => drafts[r.eventId] !== undefined && drafts[r.eventId] !== r.note;

    async function save(r: PiiNoteRow) {
        const val = draftFor(r);
        setSaving(r.eventId);
        try {
            const res = await updateEventDetails(r.eventId, val);
            if (res?.success) {
                // Cleaned of all PII heuristics → drop the row from the report right
                // away (no reload). Otherwise keep it, refreshing the type badges.
                if (!noteHasPii(val)) {
                    setItems(prev => prev.filter(x => x.eventId !== r.eventId));
                } else {
                    const f = detectNotePii(val);
                    setItems(prev => prev.map(x => (x.eventId === r.eventId
                        ? { ...x, note: val, hasPhone: f.hasPhone, hasSocial: f.hasSocial, hasAddress: f.hasAddress }
                        : x)));
                }
                setDrafts(prev => { const n = { ...prev }; delete n[r.eventId]; return n; });
                toast.success('Guardado', 'La nota se actualizó.');
            } else {
                toast.error('No se pudo guardar', res?.error === 'Unauthorized' ? 'No tenés permiso.' : 'Revisá e intentá de nuevo.', res?.error && res.error !== 'Unauthorized' ? res.error : undefined);
            }
        } catch (e) {
            toast.error('No se pudo guardar', e instanceof Error ? e.message : 'Error inesperado.');
        } finally {
            setSaving(null);
        }
    }

    async function dismiss(r: PiiNoteRow) {
        setSaving(r.eventId);
        try {
            const res = await dismissPiiNote(r.eventId);
            if (res?.success) {
                setItems(prev => prev.filter(x => x.eventId !== r.eventId));
                toast.success('Descartado', 'Marcado como falso positivo — no volverá a aparecer.', {
                    label: 'Deshacer',
                    onClick: async () => {
                        const u = await undismissPiiNote(r.eventId);
                        if (u?.success) setItems(prev => (prev.some(x => x.eventId === r.eventId) ? prev : [...prev, r]));
                    },
                });
            } else {
                toast.error('No se pudo descartar', res?.error === 'Unauthorized' ? 'No tenés permiso.' : 'Intentá de nuevo.', res?.error && res.error !== 'Unauthorized' ? res.error : undefined);
            }
        } catch (e) {
            toast.error('No se pudo descartar', e instanceof Error ? e.message : 'Error inesperado.');
        } finally {
            setSaving(null);
        }
    }

    return (
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
                <div className="flex items-center gap-1.5">
                    <VisPill label="Todos" count={items.length} active={vis === 'all'} onClick={() => setVis('all')} />
                    <VisPill label="🔒 Protegidos" count={protectedCount} active={vis === 'protected'} onClick={() => setVis('protected')} />
                </div>
                <span className="text-xs text-stone-500">
                    {`📞 ${totals.phone} · 🔗 ${totals.social} · 📍 ${totals.address}`}
                </span>
            </div>

            {visible.length === 0 ? (
                <div className="text-center text-sm text-stone-500 bg-white border border-stone-200 rounded-xl py-10">
                    {q.trim() ? `Sin resultados para “${q.trim()}”.` : vis === 'protected' ? 'Sin notas con contacto en registros protegidos. 🎉' : 'Sin notas con contacto. 🎉'}
                </div>
            ) : (
                <div className="space-y-2.5">
                    {visible.map(r => {
                        const dirty = isDirty(r);
                        const busy = saving === r.eventId;
                        return (
                            <div key={r.eventId} className="bg-white border border-stone-200 rounded-xl p-4">
                                <div className="flex gap-3 items-start justify-between flex-wrap">
                                    <div className="min-w-0">
                                        <Link href={`/adopter/${r.adopterId}`} target="_blank" className="font-semibold text-[15px] text-stone-900 hover:text-teal-700 hover:underline">
                                            {r.name || <span className="italic text-stone-400">Sin nombre</span>}
                                        </Link>
                                        <div className="flex gap-1.5 flex-wrap mt-1.5">
                                            {r.isProtected
                                                ? <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 border border-stone-200">🔒 Protegido</span>
                                                : <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">👁 Público</span>}
                                            {r.hasPhone && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200">📞 Teléfono</span>}
                                            {r.hasSocial && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">🔗 Social</span>}
                                            {r.hasAddress && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">📍 Dirección</span>}
                                        </div>
                                    </div>
                                    <Link href={`/adopter/${r.adopterId}`} target="_blank" className="text-xs font-semibold text-stone-500 hover:text-teal-700 whitespace-nowrap">Abrir ficha ↗</Link>
                                </div>

                                <textarea
                                    value={draftFor(r)}
                                    onChange={e => setDrafts(prev => ({ ...prev, [r.eventId]: e.target.value }))}
                                    rows={4}
                                    disabled={busy}
                                    className="mt-2.5 w-full text-[13px] leading-relaxed text-stone-700 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 resize-y max-h-72 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500 disabled:opacity-60"
                                    spellCheck={false}
                                />

                                <div className="flex items-center justify-between gap-2 mt-2">
                                    <button
                                        onClick={() => dismiss(r)}
                                        disabled={busy}
                                        title="No es dato de contacto (p. ej. “de la calle”). Lo saca del reporte; se puede deshacer."
                                        className="text-xs font-semibold px-3 py-1.5 rounded-lg text-stone-500 hover:text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                                    >
                                        Falso positivo
                                    </button>
                                    <div className="flex items-center gap-2">
                                    {dirty && (
                                        <button
                                            onClick={() => setDrafts(prev => { const n = { ...prev }; delete n[r.eventId]; return n; })}
                                            disabled={busy}
                                            className="text-xs font-semibold px-3 py-1.5 rounded-lg text-stone-500 hover:text-stone-700 disabled:opacity-50"
                                        >
                                            Descartar cambios
                                        </button>
                                    )}
                                    <button
                                        onClick={() => save(r)}
                                        disabled={!dirty || busy}
                                        className="text-xs font-semibold px-3.5 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        {busy ? 'Guardando…' : 'Guardar'}
                                    </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </>
    );
}


function VisPill({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors whitespace-nowrap ${
                active ? 'bg-teal-600 border-teal-600 text-white' : 'bg-white border-stone-300 text-stone-600 hover:border-teal-400'
            }`}
        >
            {label} <span className={active ? 'text-white/80' : 'text-stone-400'}>({count})</span>
        </button>
    );
}
