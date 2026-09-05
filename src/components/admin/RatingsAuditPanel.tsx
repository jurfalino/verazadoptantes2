'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { getRatingsAudit, saveRatingsAuditChanges, type RatingsAuditRow } from '@/app/actions/dataQuality';
import type { RatingsAuditQueue } from '@/domain/sentiment';
import { adopterDisplayName } from '@/lib/adopterDisplay';

/**
 * "Calificaciones vs. notas" tab of Calidad de datos: activity records whose
 * 1–5 rating disagrees with — or was never supported by — the sentiment of
 * their own note (lexicon score, src/domain/sentiment.ts). Live report: fixing
 * a record's rating or note drops the row on the next load. The "Importados"
 * switch filters by real provenance (adopters.source = 'imported'), never by
 * matching source text.
 */

const NAMELESS_LABEL = 'Sin nombre';

const QUEUE_META: Record<RatingsAuditQueue, { label: string; desc: string; rule: string[]; suggested: string }> = {
    upgrade: {
        label: 'Subir calificación',
        desc: 'Calificados 1–2 pero la nota es claramente positiva. La cola más urgente: una calificación baja equivocada perjudica a un buen adoptante. Ojo con el patrón conocido — rescatistas que narran un comienzo positivo (o sus propias buenas prácticas) antes del desenlace negativo; leé la nota completa en el perfil.',
        rule: ['calificación ≤ 2', 'sentimiento ≥ +2'],
        suggested: '→ ★4–5 (o sin calificar)',
    },
    to_one: {
        label: 'Bajar a ★1',
        desc: 'Calificados 2–3 con texto fuertemente negativo (mató, abandonó, venta, maltrato). Candidatos a “Peligroso”. Ordenados por cuán negativo puntúa el texto.',
        rule: ['calificación ∈ {2, 3}', 'sentimiento ≤ −3'],
        suggested: '→ ★1',
    },
    downgrade: {
        label: 'Alta con nota negativa',
        desc: 'Calificados ≥4 cuya nota expresa una preocupación concreta.',
        rule: ['calificación ≥ 4', 'sentimiento ≤ −1'],
        suggested: '→ ★2–3',
    },
    no_evidence: {
        label: 'Sin evidencia',
        desc: 'La calificación no se apoya en ningún texto propio. Son marcas de pertenencia (mayormente la importación 2015), no evaluaciones — pero el filtro ya no lo asume: también entran registros manuales.',
        rule: ['calificación = 2', 'sin palabras con carga', 'texto limpio vacío'],
        suggested: 'lote: descalificar + marca “en listado”',
    },
    neutral_evidence: {
        label: 'Evidencia neutra',
        desc: 'La nota es un descriptor neutro («Inquilina», una dirección, un familiar) sin carga en ningún sentido. Mismo tratamiento por lote que “Sin evidencia”, pero vale una pasada rápida: un descriptor a veces esconde una queja que el léxico no captó.',
        rule: ['calificación = 2', 'sin palabras con carga', 'texto limpio no vacío'],
        suggested: 'lote o revisión rápida',
    },
};
const QUEUE_ORDER: RatingsAuditQueue[] = ['upgrade', 'to_one', 'downgrade', 'no_evidence', 'neutral_evidence'];

const TYPE_LABEL: Record<string, string> = {
    adoption: 'adopción',
    adoption_request: 'solicitud',
    observation: 'observación',
    follow_up: 'seguimiento',
    returned_pet: 'devolución',
    foster: 'tránsito',
    available: 'disponible',
};

// Dropdown value for "no rating"; '' is the untouched sentinel elsewhere.
const NONE = 'none';

export default function RatingsAuditPanel() {
    const [rows, setRows] = useState<RatingsAuditRow[] | null>(null);
    const [canEdit, setCanEdit] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [queue, setQueue] = useState<RatingsAuditQueue>('upgrade');
    const [showImported, setShowImported] = useState(true);
    /** recordId → new rating (null = clear). Only rows that differ from current. */
    const [pending, setPending] = useState<Map<string, number | null>>(new Map());
    const [saving, setSaving] = useState(false);
    const [saveMsg, setSaveMsg] = useState<string | null>(null);
    const [, start] = useTransition();

    const load = () => {
        start(async () => {
            const res = await getRatingsAudit();
            if (res.error) setError(res.error);
            else {
                setRows(res.rows);
                setCanEdit(res.canEdit);
            }
        });
    };
    useEffect(() => { load(); }, []);

    const setRowRating = (recordId: string, current: number, value: string) => {
        setPending(prev => {
            const next = new Map(prev);
            const parsed = value === NONE ? null : Number(value);
            if (parsed === current) next.delete(recordId);
            else next.set(recordId, parsed);
            return next;
        });
    };

    async function handleSave() {
        if (pending.size === 0 || saving) return;
        setSaving(true);
        setSaveMsg(null);
        try {
            const changes = Array.from(pending, ([recordId, rating]) => ({ recordId, rating }));
            const res = await saveRatingsAuditChanges(changes);
            if (!res || res.error) {
                setSaveMsg(`No se pudieron guardar los cambios. Código: ${res?.error ?? 'sin respuesta'}`);
            } else {
                setSaveMsg(res.failed > 0
                    ? `${res.updated} guardados, ${res.failed} fallaron — revisá y reintentá.`
                    : `${res.updated} ${res.updated === 1 ? 'registro actualizado' : 'registros actualizados'}. ✓`);
                setPending(new Map());
                load(); // authoritative re-read: fixed rows drop off, partial failures stay
            }
        } finally {
            setSaving(false);
        }
    }

    const pool = useMemo(
        () => (rows ?? []).filter(r => showImported || !r.imported),
        [rows, showImported],
    );
    const counts = useMemo(() => {
        const m = new Map<RatingsAuditQueue, number>();
        for (const r of pool) m.set(r.queue, (m.get(r.queue) ?? 0) + 1);
        return m;
    }, [pool]);
    const visible = useMemo(() => {
        const q = pool.filter(r => r.queue === queue);
        // Review queues rank by |sentiment|; evidence queues group by adopter.
        if (queue === 'no_evidence' || queue === 'neutral_evidence') {
            return q.sort((a, b) => (a.adopterName ?? '').localeCompare(b.adopterName ?? ''));
        }
        return q.sort((a, b) => Math.abs(b.sentiment ?? 0) - Math.abs(a.sentiment ?? 0));
    }, [pool, queue]);
    const hiddenCount = useMemo(
        () => (rows ?? []).filter(r => r.queue === queue && r.imported).length,
        [rows, queue],
    );

    if (error) {
        return (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                No se pudo generar el reporte. {error === 'Unauthorized' ? 'No tenés permiso para verlo.' : `Código de error: ${error}`}
            </div>
        );
    }
    if (rows === null) {
        return <div className="text-center py-10 text-stone-500 text-sm">Analizando notas…</div>;
    }

    const meta = QUEUE_META[queue];
    const showSentiment = queue === 'upgrade' || queue === 'to_one' || queue === 'downgrade';

    return (
        <div className="space-y-4">
            {/* Queue pills + imported switch */}
            <div className="flex gap-2 flex-wrap items-center">
                {QUEUE_ORDER.map(q => (
                    <button
                        key={q}
                        onClick={() => setQueue(q)}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                            queue === q ? 'bg-teal-700 text-white shadow-sm' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                        }`}
                    >
                        {QUEUE_META[q].label}
                        <span className={`text-[11px] font-bold rounded-full px-1.5 ${queue === q ? 'bg-white/20' : 'bg-stone-200 text-stone-500'}`}>
                            {counts.get(q) ?? 0}
                        </span>
                    </button>
                ))}
                <label className="ml-auto flex items-center gap-2 text-xs font-semibold text-stone-600 cursor-pointer select-none">
                    <input
                        type="checkbox"
                        checked={showImported}
                        onChange={e => setShowImported(e.target.checked)}
                        className="w-4 h-4 accent-teal-700"
                    />
                    Importados
                </label>
            </div>

            {/* Queue description + exact filter rule */}
            <div className="bg-white rounded-2xl border border-stone-200 p-4">
                <p className="text-sm text-stone-600">{meta.desc}</p>
                <div className="flex gap-2 flex-wrap items-baseline mt-3">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">Filtro</span>
                    {meta.rule.map((c, i) => (
                        <span key={c} className="flex items-baseline gap-2">
                            {i > 0 && <span className="text-[11px] font-bold text-stone-400">Y</span>}
                            <code className="text-xs bg-stone-100 border border-stone-200 rounded-md px-2 py-0.5 text-stone-700">{c}</code>
                        </span>
                    ))}
                </div>
                <p className="text-xs text-stone-400 mt-2">
                    Sentimiento: puntaje léxico de la nota, −4…+4, calculado tras limpiar líneas de fuente, «cargado por…», bloques de contacto y URLs.
                    Las colas son mutuamente excluyentes. El interruptor «Importados» filtra por procedencia real del registro (importación masiva), nunca por texto.
                    Lista en vivo: corregir la calificación o la nota saca la fila.
                </p>
            </div>

            {visible.length === 0 ? (
                <div className="bg-white p-10 text-center rounded-2xl border border-stone-200 text-stone-500 text-sm">
                    {hiddenCount > 0 && !showImported
                        ? `Sin registros manuales en esta cola (${hiddenCount} importados ocultos).`
                        : 'Nada para revisar en esta cola. ✓'}
                </div>
            ) : (
                <div className="bg-white rounded-2xl shadow-sm border border-stone-200 overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-stone-50 border-b border-stone-100">
                            <tr>
                                <th className="p-3 font-semibold text-stone-500 text-sm">Adoptante</th>
                                <th className="p-3 font-semibold text-stone-500 text-sm">Origen</th>
                                <th className="p-3 font-semibold text-stone-500 text-sm">Tipo</th>
                                <th className="p-3 font-semibold text-stone-500 text-sm">Calif.</th>
                                {showSentiment && <th className="p-3 font-semibold text-stone-500 text-sm">Sentim.</th>}
                                <th className="p-3 font-semibold text-stone-500 text-sm">Sugerido</th>
                                <th className="p-3 font-semibold text-stone-500 text-sm">Nota (extracto limpio)</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-100">
                            {visible.map(r => (
                                <tr key={r.recordId} className="hover:bg-stone-50/50">
                                    <td className="p-3">
                                        <a
                                            href={`/adopter/${r.adopterId}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="font-semibold text-teal-700 hover:underline"
                                        >
                                            {adopterDisplayName({ name: r.adopterName }, NAMELESS_LABEL)} ↗
                                        </a>
                                    </td>
                                    <td className="p-3">
                                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${r.imported ? 'bg-sky-100 text-sky-800' : 'bg-stone-100 text-stone-600'}`}>
                                            {r.imported ? 'importado' : 'manual'}
                                        </span>
                                    </td>
                                    <td className="p-3 text-xs text-stone-500 whitespace-nowrap">{TYPE_LABEL[r.recordType ?? ''] ?? r.recordType}</td>
                                    <td className="p-3 whitespace-nowrap">
                                        {canEdit ? (
                                            <select
                                                value={pending.has(r.recordId)
                                                    ? (pending.get(r.recordId) === null ? NONE : String(pending.get(r.recordId)))
                                                    : String(r.rating)}
                                                onChange={e => setRowRating(r.recordId, r.rating, e.target.value)}
                                                className={`text-sm font-semibold rounded-lg border px-2 py-1 bg-white text-stone-700 ${
                                                    pending.has(r.recordId) ? 'border-teal-600 ring-1 ring-teal-600' : 'border-stone-200'
                                                }`}
                                            >
                                                {[1, 2, 3, 4, 5].map(v => <option key={v} value={v}>★{v}</option>)}
                                                <option value={NONE}>Sin calificación</option>
                                            </select>
                                        ) : (
                                            <span className="text-sm font-semibold text-stone-700">★{r.rating}</span>
                                        )}
                                    </td>
                                    {showSentiment && (
                                        <td className="p-3">
                                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${(r.sentiment ?? 0) < 0 ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'}`}>
                                                {(r.sentiment ?? 0) > 0 ? '+' : ''}{r.sentiment}
                                            </span>
                                        </td>
                                    )}
                                    <td className="p-3 text-xs font-semibold text-stone-600 whitespace-nowrap">{meta.suggested}</td>
                                    <td className="p-3 text-sm text-stone-600 max-w-md">
                                        {r.excerpt || <em className="text-stone-400">— sin texto propio —</em>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div className="p-3 text-xs text-stone-400 border-t border-stone-100">
                        {visible.length} registros{!showImported && hiddenCount > 0 ? ` · ${hiddenCount} importados ocultos por el interruptor` : ''}
                    </div>
                </div>
            )}

            {/* Save bar — sticky while there are unsaved rating changes */}
            {canEdit && (pending.size > 0 || saveMsg) && (
                <div className="sticky bottom-4 z-10">
                    <div className="bg-white rounded-2xl shadow-lg border border-stone-200 p-3 flex items-center gap-3 flex-wrap">
                        {pending.size > 0 ? (
                            <>
                                <span className="text-sm text-stone-600">
                                    {pending.size} {pending.size === 1 ? 'cambio sin guardar' : 'cambios sin guardar'}
                                </span>
                                <div className="ml-auto flex gap-2">
                                    <button
                                        onClick={() => { setPending(new Map()); setSaveMsg(null); }}
                                        disabled={saving}
                                        className="px-3 py-1.5 text-xs font-semibold text-stone-600 bg-stone-100 rounded-lg hover:bg-stone-200 disabled:opacity-50"
                                    >
                                        Descartar
                                    </button>
                                    <button
                                        onClick={handleSave}
                                        disabled={saving}
                                        className="px-4 py-1.5 text-xs font-semibold text-white bg-teal-700 rounded-lg hover:bg-teal-600 shadow-sm disabled:opacity-50"
                                    >
                                        {saving ? 'Guardando…' : `Guardar (${pending.size})`}
                                    </button>
                                </div>
                            </>
                        ) : (
                            <span className={`text-sm ${saveMsg?.includes('Código') || saveMsg?.includes('fallaron') ? 'text-red-700' : 'text-teal-700'}`}>{saveMsg}</span>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
