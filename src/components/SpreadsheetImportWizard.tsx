'use client';

import { useMemo, useState } from 'react';
import { parseSpreadsheetFile, type ParsedSheet } from '@/lib/spreadsheetParse';
import { mapImportColumns, aiCleanRowContacts } from '@/app/actions';
import { buildImportBody } from '@/lib/importRow';
import {
    TARGET_IMPORT_FIELDS, COMBINED_CONTACT, IGNORE,
    applyColumnMap, hasNameMapping,
    type ColumnMap, type ColumnAssignment,
} from '@/domain/importFields';

type RowStatus = 'created' | 'skipped' | 'failed';
interface RowResult { index: number; name: string; status: RowStatus; message?: string }

// Destination options for the per-column dropdown.
const FIELD_OPTIONS: { value: string; label: string }[] = [
    ...TARGET_IMPORT_FIELDS.map(f => ({ value: f.key, label: f.label })),
    { value: COMBINED_CONTACT, label: 'Contacto combinado (separar luego)' },
    { value: IGNORE, label: '— Ignorar —' },
];
const CONFIDENCE_DOT: Record<string, string> = {
    high: 'bg-emerald-500', medium: 'bg-amber-400', low: 'bg-stone-300',
};

type Step = 'upload' | 'map' | 'preview' | 'import';

export default function SpreadsheetImportWizard() {
    const [step, setStep] = useState<Step>('upload');
    const [fileName, setFileName] = useState('');
    const [parsed, setParsed] = useState<ParsedSheet | null>(null);
    const [map, setMap] = useState<ColumnMap | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Import (P3) state.
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const [results, setResults] = useState<RowResult[]>([]);
    const [importDone, setImportDone] = useState(false);

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

    // P3: import every row sequentially (respects D1 subrequest budget + per-row
    // tokenization). Deterministic build first; AI-escalate only messy combined
    // cells. Dedup runs inside /api/adopters (import-then-flag). One bad row never
    // aborts the batch.
    const runImport = async () => {
        if (!parsed || !map) return;
        setStep('import');
        setImportDone(false);
        setResults([]);
        setProgress({ done: 0, total: parsed.rows.length });
        const acc: RowResult[] = [];
        for (let i = 0; i < parsed.rows.length; i++) {
            const mapped = applyColumnMap(map, parsed.headers, parsed.rows[i]);
            let built = buildImportBody(mapped);
            if (built.needsAiCleanup) {
                try {
                    const extra = await aiCleanRowContacts(mapped.combinedContacts.join('\n'));
                    built = buildImportBody(mapped, extra);
                } catch { /* keep the deterministic build */ }
            }
            if (built.errors.length || !built.body) {
                acc.push({ index: i, name: mapped.name || `Fila ${i + 1}`, status: 'skipped', message: built.errors.join(' ') });
            } else {
                try {
                    const r = await fetch('/api/adopters', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(built.body) });
                    if (r.ok) {
                        acc.push({ index: i, name: built.body.name, status: 'created' });
                    } else {
                        const b = await r.json().catch(() => ({})) as { error?: string; errorId?: string };
                        acc.push({ index: i, name: built.body.name, status: 'failed', message: b.error ? `${b.error}${b.errorId ? ` (${b.errorId})` : ''}` : `HTTP ${r.status}` });
                    }
                } catch (e) {
                    acc.push({ index: i, name: built.body.name, status: 'failed', message: e instanceof Error ? e.message : 'error de red' });
                }
            }
            setProgress({ done: i + 1, total: parsed.rows.length });
            setResults([...acc]);
        }
        setImportDone(true);
    };

    const downloadErrors = () => {
        const bad = results.filter(r => r.status !== 'created');
        const csv = ['fila,nombre,estado,motivo', ...bad.map(r => `${r.index + 1},"${(r.name || '').replace(/"/g, '""')}",${r.status},"${(r.message || '').replace(/"/g, '""')}"`)].join('\n');
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        const a = document.createElement('a');
        a.href = url; a.download = 'errores-importacion.csv'; a.click();
        URL.revokeObjectURL(url);
    };

    const tally = {
        created: results.filter(r => r.status === 'created').length,
        skipped: results.filter(r => r.status === 'skipped').length,
        failed: results.filter(r => r.status === 'failed').length,
    };

    return (
        <div className="max-w-4xl mx-auto p-4">
            <h1 className="text-2xl font-extrabold text-stone-900 mb-1">Importar adopciones desde planilla</h1>
            <p className="text-sm text-stone-500 mb-6">Subí un CSV; la IA propone cómo mapear tus columnas y vos lo validás antes de importar.</p>

            {/* Steps indicator */}
            <div className="flex gap-2 mb-6 text-xs font-semibold">
                {(['upload', 'map', 'preview', 'import'] as Step[]).map((s, i) => (
                    <span key={s} className={`px-3 py-1 rounded-full ${step === s ? 'bg-stone-800 text-white' : 'bg-stone-100 text-stone-500'}`}>
                        {i + 1}. {s === 'upload' ? 'Subir' : s === 'map' ? 'Mapear' : s === 'preview' ? 'Previsualizar' : 'Importar'}
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
                        <button onClick={runImport}
                            className="px-5 py-2 text-sm font-semibold text-white bg-teal-600 rounded-xl hover:bg-teal-700">
                            Importar {parsed.rowCount} filas →
                        </button>
                    </div>
                </div>
            )}

            {/* STEP 4: Import (progress + results) */}
            {step === 'import' && (
                <div>
                    <div className="mb-2 flex items-center justify-between text-sm">
                        <span className="font-semibold text-stone-700">{importDone ? 'Importación completa' : 'Importando…'}</span>
                        <span className="text-stone-500">{progress.done} / {progress.total}</span>
                    </div>
                    <div className="h-3 rounded-full bg-stone-100 overflow-hidden mb-4">
                        <div className="h-full bg-teal-500 transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
                    </div>

                    <div className="flex gap-3 mb-4 text-sm">
                        <span className="px-3 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-medium">✅ {tally.created} creados</span>
                        <span className="px-3 py-1 rounded-lg bg-amber-50 text-amber-700 font-medium">⏭️ {tally.skipped} omitidos</span>
                        <span className="px-3 py-1 rounded-lg bg-rose-50 text-rose-700 font-medium">⚠️ {tally.failed} fallidos</span>
                    </div>

                    {!importDone && <p className="text-xs text-stone-400 mb-4">Puede tardar unos minutos (cada fila se verifica y tokeniza). No cierres la pestaña.</p>}

                    {(tally.skipped + tally.failed) > 0 && (
                        <div className="border border-stone-200 rounded-xl overflow-hidden mb-4">
                            <div className="bg-stone-50 px-3 py-2 text-xs uppercase tracking-wider text-stone-500 flex items-center justify-between">
                                <span>Filas no importadas</span>
                                {importDone && <button onClick={downloadErrors} className="text-teal-600 hover:underline normal-case tracking-normal">Descargar CSV</button>}
                            </div>
                            <div className="max-h-64 overflow-y-auto">
                                {results.filter(r => r.status !== 'created').map(r => (
                                    <div key={r.index} className="px-3 py-1.5 text-sm border-t border-stone-100 flex gap-2">
                                        <span className="text-stone-400 w-10 flex-shrink-0">#{r.index + 1}</span>
                                        <span className="font-medium text-stone-700 w-40 flex-shrink-0 truncate">{r.name}</span>
                                        <span className={r.status === 'failed' ? 'text-rose-600' : 'text-amber-600'}>{r.message || r.status}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {importDone && (
                        <div className="flex items-center justify-between gap-4">
                            <p className="text-xs text-stone-400">Los posibles duplicados con registros existentes quedan marcados para revisar/fusionar en cada perfil. Reimportar la misma planilla vuelve a crear registros (marcados como duplicados).</p>
                            <button onClick={() => { setStep('upload'); setParsed(null); setMap(null); setResults([]); setImportDone(false); }}
                                className="flex-shrink-0 px-5 py-2 text-sm font-semibold text-white bg-teal-600 rounded-xl hover:bg-teal-700">
                                Importar otra planilla
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
