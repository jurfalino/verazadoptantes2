'use client';

import { useMemo, useState } from 'react';
import { parseSpreadsheetFile, type ParsedSheet } from '@/lib/spreadsheetParse';
import { mapImportColumns } from '@/app/actions';
import {
    TARGET_IMPORT_FIELDS, COMBINED_CONTACT, IGNORE,
    applyColumnMap, hasNameMapping,
    type ColumnMap, type ColumnAssignment,
} from '@/domain/importFields';

// Destination options for the per-column dropdown.
const FIELD_OPTIONS: { value: string; label: string }[] = [
    ...TARGET_IMPORT_FIELDS.map(f => ({ value: f.key, label: f.label })),
    { value: COMBINED_CONTACT, label: 'Contacto combinado (separar luego)' },
    { value: IGNORE, label: '— Ignorar —' },
];
const CONFIDENCE_DOT: Record<string, string> = {
    high: 'bg-emerald-500', medium: 'bg-amber-400', low: 'bg-stone-300',
};

type Step = 'upload' | 'map' | 'preview';

export default function SpreadsheetImportWizard() {
    const [step, setStep] = useState<Step>('upload');
    const [fileName, setFileName] = useState('');
    const [parsed, setParsed] = useState<ParsedSheet | null>(null);
    const [map, setMap] = useState<ColumnMap | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleFile = async (file: File) => {
        setError(null);
        setBusy(true);
        try {
            const sheet = await parseSpreadsheetFile(file);
            if (sheet.headers.length === 0) { setError('El archivo está vacío o no tiene encabezados.'); setBusy(false); return; }
            setFileName(file.name);
            setParsed(sheet);
            setStep('map');
            // Ask the AI to propose a column mapping (headers + up to 5 sample rows).
            const aiMap = await mapImportColumns(sheet.headers, sheet.rows.slice(0, 5), 'es');
            setMap(aiMap);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'No se pudo leer el archivo.');
            setStep('upload');
        } finally {
            setBusy(false);
        }
    };

    const setAssignment = (column: string, field: string) => {
        if (!map) return;
        setMap({
            ...map,
            columns: map.columns.map(c => c.column === column ? { ...c, field, confidence: 'high' } as ColumnAssignment : c),
        });
    };

    // First non-empty sample value per column, for the mapping table.
    const sampleFor = useMemo(() => {
        const m = new Map<string, string>();
        if (!parsed) return m;
        parsed.headers.forEach((h, i) => {
            const v = parsed.rows.find(r => (r[i] ?? '').trim())?.[i] ?? '';
            m.set(h, v);
        });
        return m;
    }, [parsed]);

    // Preview: project the first 20 rows onto the schema.
    const preview = useMemo(() => {
        if (!parsed || !map) return [];
        return parsed.rows.slice(0, 20).map(r => applyColumnMap(map, parsed.headers, r));
    }, [parsed, map]);

    const nameMapped = map ? hasNameMapping(map) : false;
    const rowsMissingName = preview.filter(p => !p.name).length;

    return (
        <div className="max-w-4xl mx-auto p-4">
            <h1 className="text-2xl font-extrabold text-stone-900 mb-1">Importar adopciones desde planilla</h1>
            <p className="text-sm text-stone-500 mb-6">Subí un CSV; la IA propone cómo mapear tus columnas y vos lo validás antes de importar.</p>

            {/* Steps indicator */}
            <div className="flex gap-2 mb-6 text-xs font-semibold">
                {(['upload', 'map', 'preview'] as Step[]).map((s, i) => (
                    <span key={s} className={`px-3 py-1 rounded-full ${step === s ? 'bg-stone-800 text-white' : 'bg-stone-100 text-stone-500'}`}>
                        {i + 1}. {s === 'upload' ? 'Subir' : s === 'map' ? 'Mapear' : 'Previsualizar'}
                    </span>
                ))}
            </div>

            {error && <div className="mb-4 p-3 rounded-lg bg-rose-50 text-rose-700 text-sm border border-rose-200">{error}</div>}

            {/* STEP 1: Upload */}
            {step === 'upload' && (
                <label className="block border-2 border-dashed border-stone-300 rounded-2xl p-12 text-center cursor-pointer hover:border-teal-400 transition-colors">
                    <input type="file" accept=".csv,text/csv" className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
                    <div className="text-4xl mb-2" aria-hidden>📄</div>
                    <div className="font-semibold text-stone-700">{busy ? 'Leyendo…' : 'Elegí un archivo CSV'}</div>
                    <div className="text-xs text-stone-400 mt-1">.csv (Excel próximamente)</div>
                </label>
            )}

            {/* STEP 2: Mapping editor */}
            {step === 'map' && parsed && (
                <div>
                    <div className="flex items-center justify-between mb-3">
                        <div className="text-sm text-stone-600">
                            <span className="font-semibold">{fileName}</span> · {parsed.rowCount} filas · {parsed.headers.length} columnas
                        </div>
                        {busy && <span className="text-xs text-teal-600">🤖 Mapeando con IA…</span>}
                    </div>

                    {!nameMapped && !busy && (
                        <div className="mb-3 p-3 rounded-lg bg-amber-50 text-amber-800 text-sm border border-amber-200">
                            ⚠️ Ninguna columna está mapeada como <b>Nombre del adoptante</b> (obligatorio). Asigná una para continuar.
                        </div>
                    )}

                    <div className="border border-stone-200 rounded-xl overflow-hidden">
                        <table className="w-full text-sm">
                            <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider">
                                <tr><th className="text-left px-3 py-2">Columna</th><th className="text-left px-3 py-2">Ejemplo</th><th className="text-left px-3 py-2">Mapear a</th></tr>
                            </thead>
                            <tbody>
                                {map?.columns.map(c => (
                                    <tr key={c.column} className="border-t border-stone-100">
                                        <td className="px-3 py-2 font-medium text-stone-800">{c.column}</td>
                                        <td className="px-3 py-2 text-stone-400 truncate max-w-[180px]">{sampleFor.get(c.column) || <span className="italic">vacío</span>}</td>
                                        <td className="px-3 py-2">
                                            <div className="flex items-center gap-2">
                                                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${CONFIDENCE_DOT[c.confidence]}`} title={`confianza IA: ${c.confidence}`} aria-hidden />
                                                <select
                                                    value={c.field}
                                                    onChange={e => setAssignment(c.column, e.target.value)}
                                                    className="text-sm border border-stone-200 rounded-lg px-2 py-1 bg-white focus:border-teal-400 outline-none"
                                                >
                                                    {FIELD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                                </select>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {map?.notes && <p className="text-xs text-stone-400 mt-2 italic">Nota de la IA: {map.notes}</p>}

                    <div className="flex justify-between mt-4">
                        <button onClick={() => { setStep('upload'); setParsed(null); setMap(null); }} className="px-4 py-2 text-sm text-stone-500 hover:text-stone-700">← Empezar de nuevo</button>
                        <button disabled={!nameMapped || busy} onClick={() => setStep('preview')}
                            className="px-5 py-2 text-sm font-semibold text-white bg-teal-600 rounded-xl hover:bg-teal-700 disabled:opacity-40">
                            Previsualizar →
                        </button>
                    </div>
                </div>
            )}

            {/* STEP 3: Preview */}
            {step === 'preview' && parsed && map && (
                <div>
                    <div className="mb-3 text-sm text-stone-600">
                        Vista previa de {preview.length} de {parsed.rowCount} filas mapeadas.
                        {rowsMissingName > 0 && <span className="text-rose-600 ml-2">⚠️ {rowsMissingName} sin nombre (se omitirían).</span>}
                    </div>
                    <div className="border border-stone-200 rounded-xl overflow-x-auto">
                        <table className="w-full text-sm whitespace-nowrap">
                            <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider">
                                <tr>
                                    <th className="text-left px-3 py-2">Nombre</th>
                                    <th className="text-left px-3 py-2">Contactos</th>
                                    <th className="text-left px-3 py-2">Animal</th>
                                    <th className="text-left px-3 py-2">Tipo / Rating / Fecha</th>
                                </tr>
                            </thead>
                            <tbody>
                                {preview.map((p, i) => (
                                    <tr key={i} className={`border-t border-stone-100 ${!p.name ? 'bg-rose-50' : ''}`}>
                                        <td className="px-3 py-2 font-medium text-stone-800">{p.name || <span className="text-rose-500 italic">falta</span>}</td>
                                        <td className="px-3 py-2 text-stone-500">
                                            {[...p.phones, ...p.emails, ...p.socials, ...p.addresses, ...p.dnis].join(' · ') || '—'}
                                            {p.combinedContacts.length > 0 && <span className="ml-1 text-indigo-500" title="se separará por fila">🧩 {p.combinedContacts.join(' ')}</span>}
                                        </td>
                                        <td className="px-3 py-2 text-stone-500">{[p.animalName, p.species].filter(Boolean).join(' · ') || '—'}</td>
                                        <td className="px-3 py-2 text-stone-500">{[p.recordType, p.rating, p.date].filter(Boolean).join(' · ') || '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="flex justify-between mt-4">
                        <button onClick={() => setStep('map')} className="px-4 py-2 text-sm text-stone-500 hover:text-stone-700">← Ajustar mapeo</button>
                        <button disabled title="La importación se implementa en el siguiente paso (P3)"
                            className="px-5 py-2 text-sm font-semibold text-white bg-teal-600 rounded-xl opacity-40 cursor-not-allowed">
                            Importar (próximamente)
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
