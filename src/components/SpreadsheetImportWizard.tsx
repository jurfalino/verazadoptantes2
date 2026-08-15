'use client';

import { useMemo, useState } from 'react';
import { parseSpreadsheetFile, type ParsedSheet } from '@/lib/spreadsheetParse';
import { mapImportColumns, interpretRows, aiCleanRowContacts } from '@/app/actions';
import { buildImportBody } from '@/lib/importRow';
import { normalizeSpecies, normalizeImportDate, normalizeRating, normalizeRecordType } from '@/domain/importRow';
import {
    TARGET_IMPORT_FIELDS, COMBINED_CONTACT, IGNORE,
    applyColumnMap, emptyMappedRow, guessColumnMap,
    type ColumnMap, type MappedRow,
} from '@/domain/importFields';

type RowStatus = 'created' | 'skipped' | 'failed';
interface RowResult { index: number; name: string; status: RowStatus; message?: string }

const FIELD_OPTIONS = [
    ...TARGET_IMPORT_FIELDS.map(f => ({ value: f.key, label: f.label })),
    { value: COMBINED_CONTACT, label: 'Contacto combinado (separar luego)' },
    { value: IGNORE, label: '— Ignorar —' },
];
const CONFIDENCE_DOT: Record<string, string> = { high: 'bg-emerald-500', medium: 'bg-amber-400', low: 'bg-stone-300' };
const RECORD_TYPES = ['adoption', 'foster', 'observation', 'adoption_request', 'follow_up', 'returned_pet'];
const RECORD_TYPE_LABELS: Record<string, string> = {
    adoption: 'Adopción', foster: 'Tránsito', observation: 'Observación',
    adoption_request: 'Solicitud', follow_up: 'Seguimiento', returned_pet: 'Devolución',
};
// Species dropdown — value normalizes cleanly via normalizeSpecies; empty = sin especie.
const SPECIES_OPTIONS: Array<{ v: string; l: string }> = [
    { v: '', l: '— Especie —' }, { v: 'dog', l: 'Perro' }, { v: 'cat', l: 'Gato' },
    { v: 'bird', l: 'Ave' }, { v: 'other', l: 'Otro' },
];
const RATING_OPTIONS = ['', '1', '2', '3', '4', '5'];
// Map any interpreted species string onto one of the dropdown option values.
function speciesOptionValue(raw: string | undefined): string {
    const norm = normalizeSpecies(raw);
    if (!norm) return '';
    const canon = norm.toLowerCase();
    return SPECIES_OPTIONS.some(o => o.v === canon) ? canon : 'other';
}

type Step = 'upload' | 'confirm' | 'import';
type Filter = 'all' | 'valid' | 'invalid' | 'warnings';

export default function SpreadsheetImportWizard() {
    const [step, setStep] = useState<Step>('upload');
    const [fileName, setFileName] = useState('');
    const [parsed, setParsed] = useState<ParsedSheet | null>(null);
    const [map, setMap] = useState<ColumnMap | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Interpretation: 'ai' = AI ingested the rows directly; 'mapping' = deterministic
    // column-mapping fallback. AI is the default.
    const [mode, setMode] = useState<'ai' | 'mapping'>('mapping');
    const [interpreted, setInterpreted] = useState<MappedRow[]>([]);
    const [interpretProgress, setInterpretProgress] = useState({ done: 0, total: 0 });
    // Confirmation-grid state.
    const [overrides, setOverrides] = useState<Record<number, Partial<MappedRow>>>({});
    const [deselected, setDeselected] = useState<Set<number>>(new Set());
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState<Filter>('all');
    const [typeFilter, setTypeFilter] = useState<string>('all');     // recordType, or 'all'
    const [ratingFilter, setRatingFilter] = useState<string>('all'); // '1'..'5', 'none', or 'all'
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [editing, setEditing] = useState<number | null>(null);
    // Import state.
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const [results, setResults] = useState<RowResult[]>([]);
    const [importDone, setImportDone] = useState(false);

    const handleFile = async (file: File) => {
        setError(null); setBusy(true);
        try {
            const sheet = await parseSpreadsheetFile(file);
            if (sheet.headers.length === 0) { setError('El archivo está vacío o no tiene encabezados.'); setBusy(false); return; }
            setFileName(file.name); setParsed(sheet); setOverrides({}); setDeselected(new Set());
            // Default: deterministic column-mapping, ready INSTANTLY. `guessColumnMap`
            // matches header names offline (no AI, no per-row wait) — the grid renders
            // immediately via applyColumnMap. The user tweaks any wrong field in the
            // mapping panel, or opts into AI interpretation for genuinely messy sheets
            // (runAiInterpretation). This flips the old default, which eagerly ran
            // ~N/20 sequential AI calls over every row before the grid could appear.
            setInterpreted([]); setInterpretProgress({ done: 0, total: 0 });
            setMap(guessColumnMap(sheet.headers)); setMode('mapping'); setAdvancedOpen(true);
            setStep('confirm');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'No se pudo leer el archivo.'); setStep('upload');
        } finally { setBusy(false); }
    };

    // Opt-in AI interpretation for messy sheets: send each row to the model
    // (chunked, with progress) so it extracts structured fields the deterministic
    // column-map can't. Slow (one request per ~20 rows), so it's never eager.
    const runAiInterpretation = async () => {
        if (!parsed) return;
        setError(null); setBusy(true); setMode('ai'); setInterpreted([]);
        try {
            setInterpretProgress({ done: 0, total: parsed.rows.length });
            const CHUNK = 20;
            const acc: MappedRow[] = [];
            for (let i = 0; i < parsed.rows.length; i += CHUNK) {
                const chunk = parsed.rows.slice(i, i + CHUNK);
                try {
                    acc.push(...await interpretRows(parsed.headers, chunk, 'es'));
                } catch (chunkErr) {
                    // First chunk failed → AI unavailable → bail back to mapping.
                    // A later chunk failing keeps what we have and pads this chunk
                    // with empty rows (visible as errors) rather than discarding.
                    if (acc.length === 0) throw chunkErr;
                    acc.push(...chunk.map(() => emptyMappedRow()));
                }
                setInterpreted([...acc]);
                setInterpretProgress({ done: Math.min(i + CHUNK, parsed.rows.length), total: parsed.rows.length });
            }
        } catch {
            // AI unavailable — stay on the deterministic column-map (already set).
            setMode('mapping'); setError('No se pudo interpretar con IA. Usá el mapeo de columnas.');
        } finally { setBusy(false); }
    };

    // Manual escape hatch: switch to deterministic column-mapping (e.g. if the AI
    // misinterpreted the sheet). Fetches a proposed mapping if we don't have one.
    const switchToMapping = async () => {
        if (!parsed) return;
        setMode('mapping'); setAdvancedOpen(true); setOverrides({});
        if (!map) {
            setBusy(true);
            try { setMap(await mapImportColumns(parsed.headers, parsed.rows.slice(0, 5), 'es')); }
            finally { setBusy(false); }
        }
    };

    const setAssignment = (column: string, field: string) => {
        if (!map) return;
        setMap({ ...map, columns: map.columns.map(c => c.column === column ? { ...c, field, confidence: 'high' as const } : c) });
    };
    const setOverride = (i: number, patch: Partial<MappedRow>) => setOverrides(o => ({ ...o, [i]: { ...o[i], ...patch } }));
    const toggle = (i: number) => setDeselected(s => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
    // Bulk-set a rating on every row (empty = clear the override, back to the
    // system/AI-determined value).
    const setRatingAll = (rating: string) => {
        if (!parsed) return;
        setOverrides(o => {
            const n = { ...o };
            parsed.rows.forEach((_, i) => { n[i] = { ...n[i], rating: rating || undefined }; });
            return n;
        });
    };
    // Bulk-set visibility (público/protegido) on every row.
    const setVisibilityAll = (isPublic: boolean) => {
        if (!parsed) return;
        setOverrides(o => {
            const n = { ...o };
            parsed.rows.forEach((_, i) => { n[i] = { ...n[i], isPublic }; });
            return n;
        });
    };

    // Derive final records (AI interpretation OR column mapping, + per-row edits).
    const records = useMemo(() => {
        if (!parsed) return [];
        return parsed.rows.map((row, i) => {
            const base: MappedRow = mode === 'ai'
                ? (interpreted[i] ?? { name: '', phones: [], emails: [], socials: [], addresses: [], dnis: [], combinedContacts: [] })
                : (map ? applyColumnMap(map, parsed.headers, row) : { name: '', phones: [], emails: [], socials: [], addresses: [], dnis: [], combinedContacts: [] });
            const eff: MappedRow = { ...base, ...(overrides[i] || {}) };
            return { index: i, eff, built: buildImportBody(eff), selected: !deselected.has(i) };
        });
    }, [parsed, mode, interpreted, map, overrides, deselected]);

    const filtered = useMemo(() => records.filter(r => {
        if (filter === 'valid' && r.built.errors.length) return false;
        if (filter === 'invalid' && !r.built.errors.length) return false;
        if (filter === 'warnings' && !r.built.warnings.length) return false;
        if (typeFilter !== 'all' && normalizeRecordType(r.eff.recordType) !== typeFilter) return false;
        if (ratingFilter !== 'all') {
            const nr = normalizeRating(r.eff.rating);
            if (ratingFilter === 'none' ? nr !== null : String(nr) !== ratingFilter) return false;
        }
        if (search.trim()) {
            // Type-ahead across ALL fields (name, every contact type, animal, motivo…).
            const e = r.eff;
            const hay = [
                e.name, e.animalName, e.species, e.details, e.onBehalfOf,
                ...e.phones, ...e.emails, ...e.socials, ...e.addresses, ...e.dnis, ...e.combinedContacts,
            ].filter(Boolean).join(' ').toLowerCase();
            if (!hay.includes(search.trim().toLowerCase())) return false;
        }
        return true;
    }), [records, filter, typeFilter, ratingFilter, search]);

    const importable = records.filter(r => r.selected && r.built.errors.length === 0);
    const selectedInvalid = records.filter(r => r.selected && r.built.errors.length > 0).length;
    const selectedWarnings = records.filter(r => r.selected && r.built.errors.length === 0 && r.built.warnings.length > 0).length;

    const runImport = async () => {
        setStep('import'); setImportDone(false); setResults([]);
        const targets = records.filter(r => r.selected);
        setProgress({ done: 0, total: targets.length });
        const acc: RowResult[] = [];
        for (let k = 0; k < targets.length; k++) {
            const { index, eff } = targets[k];
            let built = buildImportBody(eff);
            if (built.needsAiCleanup) {
                try { built = buildImportBody(eff, await aiCleanRowContacts(eff.combinedContacts.join('\n'))); } catch { /* keep deterministic */ }
            }
            if (built.errors.length || !built.body) {
                acc.push({ index, name: eff.name || `Fila ${index + 1}`, status: 'skipped', message: built.errors.join(' ') });
            } else {
                // Anonymous rows (no name) default to público so their contacts are
                // findable; named rows default to protegido (undefined = route default).
                // Per-row/bulk overrides (eff.isPublic) always win.
                const isAnon = !eff.name?.trim();
                const effPublic = eff.isPublic !== undefined ? eff.isPublic : (isAnon ? true : undefined);
                try {
                    const r = await fetch('/api/adopters', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...built.body, ...(effPublic !== undefined ? { isPublic: effPublic } : {}) }) });
                    if (r.ok) acc.push({ index, name: built.body.name, status: 'created' });
                    else { const b = await r.json().catch(() => ({})) as { error?: string; errorId?: string }; acc.push({ index, name: built.body.name, status: 'failed', message: b.error ? `${b.error}${b.errorId ? ` (${b.errorId})` : ''}` : `HTTP ${r.status}` }); }
                } catch (e) { acc.push({ index, name: built.body!.name, status: 'failed', message: e instanceof Error ? e.message : 'error de red' }); }
            }
            setProgress({ done: k + 1, total: targets.length }); setResults([...acc]);
        }
        setImportDone(true);
    };

    const downloadErrors = () => {
        const bad = results.filter(r => r.status !== 'created');
        const csv = ['fila,nombre,estado,motivo', ...bad.map(r => `${r.index + 1},"${(r.name || '').replace(/"/g, '""')}",${r.status},"${(r.message || '').replace(/"/g, '""')}"`)].join('\n');
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        const a = document.createElement('a'); a.href = url; a.download = 'errores-importacion.csv'; a.click(); URL.revokeObjectURL(url);
    };

    const tally = { created: results.filter(r => r.status === 'created').length, skipped: results.filter(r => r.status === 'skipped').length, failed: results.filter(r => r.status === 'failed').length };
    const reset = () => { setStep('upload'); setParsed(null); setMap(null); setInterpreted([]); setMode('mapping'); setResults([]); setImportDone(false); setOverrides({}); setDeselected(new Set()); setSearch(''); setFilter('all'); setTypeFilter('all'); setRatingFilter('all'); };

    return (
        <div className="max-w-5xl mx-auto p-4">
            <h1 className="text-2xl font-extrabold text-stone-900 mb-1">Importar adopciones desde planilla</h1>
            <p className="text-sm text-stone-500 mb-6">Subí una planilla (CSV o Excel) en cualquier formato; la IA la interpreta y vos validás/editás los registros antes de importar.</p>

            <div className="flex gap-2 mb-6 text-xs font-semibold">
                {(['upload', 'confirm', 'import'] as Step[]).map((s, i) => (
                    <span key={s} className={`px-3 py-1 rounded-full ${step === s ? 'bg-stone-800 text-white' : 'bg-stone-100 text-stone-500'}`}>
                        {i + 1}. {s === 'upload' ? 'Subir' : s === 'confirm' ? 'Revisar' : 'Importar'}
                    </span>
                ))}
            </div>

            {error && <div className="mb-4 p-3 rounded-lg bg-rose-50 text-rose-700 text-sm border border-rose-200">{error}</div>}

            {step === 'upload' && (
                <label className="block border-2 border-dashed border-stone-300 rounded-2xl p-12 text-center cursor-pointer hover:border-teal-400 transition-colors">
                    <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
                    <div className="text-4xl mb-2" aria-hidden>📄</div>
                    <div className="font-semibold text-stone-700">{busy ? 'Leyendo…' : 'Elegí un archivo'}</div>
                    <div className="text-xs text-stone-400 mt-1">CSV o Excel (.xlsx)</div>
                </label>
            )}

            {step === 'confirm' && parsed && (
                <div>
                    <div className="flex items-center justify-between mb-3 text-sm text-stone-600">
                        <span><span className="font-semibold">{fileName}</span> · {parsed.rowCount} filas</span>
                    </div>

                    {busy ? (
                        /* #1: while the AI interprets the rows, show a loading state — NOT
                           the not-yet-interpreted rows, which render as red "falta" errors
                           and make the screen look broken. */
                        <div className="border border-stone-200 rounded-xl p-6">
                            <div className="text-sm text-teal-700 mb-3 flex items-center gap-2">
                                <span className="inline-block w-4 h-4 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" aria-hidden />
                                {mode === 'ai' && interpretProgress.total > 0
                                    ? `Interpretando ${interpretProgress.total} filas con IA… ${interpretProgress.done}/${interpretProgress.total}`
                                    : 'Preparando la lista de registros…'}
                            </div>
                            {mode === 'ai' && interpretProgress.total > 0 && (
                                <div className="h-2 rounded-full bg-stone-100 overflow-hidden mb-4"><div className="h-full bg-teal-500 transition-all" style={{ width: `${(interpretProgress.done / interpretProgress.total) * 100}%` }} /></div>
                            )}
                            <div className="space-y-2">
                                {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-9 rounded-lg bg-stone-100 animate-pulse" />)}
                            </div>
                        </div>
                    ) : (
                    <>
                    {/* Mode: deterministic column-mapping (default, instant) with an
                        opt-in to AI interpretation, or the AI view with an escape hatch. */}
                    {mode === 'ai' ? (
                        <div className="mb-4 p-3 rounded-lg bg-teal-50 border border-teal-100 text-sm text-teal-800 flex items-center justify-between gap-3">
                            <span>🤖 {records.length} registros interpretados por IA — revisalos y editá lo que haga falta.</span>
                            <button onClick={switchToMapping} className="flex-shrink-0 text-teal-700 hover:underline">¿Mal interpretado? Mapear columnas</button>
                        </div>
                    ) : (
                        <div className="border border-stone-200 rounded-xl mb-4">
                            <div className="px-4 py-2.5 flex items-center justify-between gap-3 text-sm border-b border-stone-100">
                                <span className="text-stone-600">📋 <span className="font-medium">Mapeo por columnas</span> — instantáneo. Revisá que cada columna apunte al campo correcto.</span>
                                <button onClick={runAiInterpretation} className="flex-shrink-0 text-teal-700 hover:underline" title="Para planillas desordenadas (varios contactos en una celda, formatos raros)">🤖 ¿Columnas mezcladas? Interpretar con IA</button>
                            </div>
                            <button onClick={() => setAdvancedOpen(o => !o)} className="w-full text-left px-4 py-2 text-sm font-medium text-stone-600 flex items-center justify-between">
                                <span>⚙️ Mapeo de columnas</span>
                                <span className="text-stone-400">{advancedOpen ? '▲' : '▼'}</span>
                            </button>
                            {advancedOpen && map && (
                                <div className="px-4 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {map.columns.map(c => (
                                        <div key={c.column} className="flex items-center gap-2 text-sm">
                                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${CONFIDENCE_DOT[c.confidence]}`} aria-hidden />
                                            <span className="font-medium text-stone-700 w-28 truncate" title={c.column}>{c.column}</span>
                                            <select value={c.field} onChange={e => setAssignment(c.column, e.target.value)} className="flex-1 text-sm border border-stone-200 rounded-lg px-2 py-1 bg-white">
                                                {FIELD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                            </select>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Toolbar: type-ahead search (all fields) + filters (validez/tipo/rating) + bulk-rating + counts */}
                    <div className="space-y-2 mb-3">
                        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar en todos los campos (nombre, contacto, animal, motivo…)" className="w-full h-9 px-3 rounded-lg border border-stone-200 text-sm outline-none focus:border-teal-400" />
                        <div className="flex flex-wrap items-center gap-2">
                            <select value={filter} onChange={e => setFilter(e.target.value as Filter)} className="h-9 px-2 rounded-lg border border-stone-200 text-sm bg-white" title="Validez">
                                <option value="all">Validez: todas</option>
                                <option value="valid">Válidos ({records.filter(r => !r.built.errors.length).length})</option>
                                <option value="invalid">Con errores ({records.filter(r => r.built.errors.length).length})</option>
                                <option value="warnings">Con advertencias ({records.filter(r => r.built.warnings.length).length})</option>
                            </select>
                            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="h-9 px-2 rounded-lg border border-stone-200 text-sm bg-white" title="Tipo de actividad">
                                <option value="all">Tipo: todos</option>
                                {RECORD_TYPES.map(t => <option key={t} value={t}>{RECORD_TYPE_LABELS[t] ?? t}</option>)}
                            </select>
                            <select value={ratingFilter} onChange={e => setRatingFilter(e.target.value)} className="h-9 px-2 rounded-lg border border-stone-200 text-sm bg-white" title="Rating">
                                <option value="all">Rating: todos</option>
                                {['1', '2', '3', '4', '5'].map(n => <option key={n} value={n}>{n} ★</option>)}
                                <option value="none">Sin rating</option>
                            </select>
                            {/* Massively set a rating on every row. Controlled value="" so it snaps back. */}
                            <select value="" onChange={e => { if (e.target.value) setRatingAll(e.target.value === 'clear' ? '' : e.target.value); }} className="h-9 px-2 rounded-lg border border-stone-200 text-sm bg-white text-stone-600" title="Asignar un rating a todos los registros">
                                <option value="">Rating a todos…</option>
                                {['1', '2', '3', '4', '5'].map(n => <option key={n} value={n}>{n} ★ a todos</option>)}
                                <option value="clear">Limpiar rating</option>
                            </select>
                            {/* Massively set visibility on every row. Controlled value="" so it snaps back. */}
                            <select value="" onChange={e => { if (e.target.value) setVisibilityAll(e.target.value === 'public'); }} className="h-9 px-2 rounded-lg border border-stone-200 text-sm bg-white text-stone-600" title="Asignar visibilidad a todos los registros">
                                <option value="">Visibilidad a todos…</option>
                                <option value="public">Todos públicos</option>
                                <option value="protected">Todos protegidos</option>
                            </select>
                            {(filter !== 'all' || typeFilter !== 'all' || ratingFilter !== 'all' || search.trim() !== '') && (
                                <button onClick={() => { setFilter('all'); setTypeFilter('all'); setRatingFilter('all'); setSearch(''); }} className="h-9 px-2 text-sm text-stone-500 hover:text-stone-700">✕ Limpiar filtros</button>
                            )}
                            <span className="text-sm text-stone-500 ml-auto">Mostrando {filtered.length} de {records.length} · {importable.length} se importarán{selectedWarnings > 0 && <span className="text-amber-600"> · {selectedWarnings} con advertencias</span>}{selectedInvalid > 0 && <span className="text-rose-500"> · {selectedInvalid} con errores</span>}</span>
                        </div>
                    </div>

                    <div className="border border-stone-200 rounded-xl overflow-hidden">
                        <div className="max-h-[420px] overflow-y-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider sticky top-0">
                                    <tr><th className="px-2 py-2"></th><th className="text-left px-3 py-2">Nombre</th><th className="text-left px-3 py-2">Contactos</th><th className="text-left px-3 py-2">Animal · tipo · rating · fecha</th><th className="px-2 py-2"></th></tr>
                                </thead>
                                <tbody>
                                    {filtered.map(r => (
                                        <RowView key={r.index} r={r} editing={editing === r.index}
                                            onToggle={() => toggle(r.index)} onEdit={() => setEditing(editing === r.index ? null : r.index)}
                                            onChange={patch => setOverride(r.index, patch)} />
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="flex justify-between mt-4">
                        <button onClick={reset} className="px-4 py-2 text-sm text-stone-500 hover:text-stone-700">← Empezar de nuevo</button>
                        <button disabled={importable.length === 0} onClick={runImport} className="px-5 py-2 text-sm font-semibold text-white bg-teal-600 rounded-xl hover:bg-teal-700 disabled:opacity-40">
                            Importar {importable.length} registros →
                        </button>
                    </div>
                    </>
                    )}
                </div>
            )}

            {step === 'import' && (
                <div>
                    <div className="mb-2 flex items-center justify-between text-sm">
                        <span className="font-semibold text-stone-700">{importDone ? 'Importación completa' : 'Importando…'}</span>
                        <span className="text-stone-500">{progress.done} / {progress.total}</span>
                    </div>
                    <div className="h-3 rounded-full bg-stone-100 overflow-hidden mb-4"><div className="h-full bg-teal-500 transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /></div>
                    <div className="flex gap-3 mb-4 text-sm">
                        <span className="px-3 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-medium">✅ {tally.created} creados</span>
                        <span className="px-3 py-1 rounded-lg bg-amber-50 text-amber-700 font-medium">⏭️ {tally.skipped} omitidos</span>
                        <span className="px-3 py-1 rounded-lg bg-rose-50 text-rose-700 font-medium">⚠️ {tally.failed} fallidos</span>
                    </div>
                    {!importDone && <p className="text-xs text-stone-400 mb-4">Puede tardar unos minutos (cada fila se verifica y tokeniza). No cierres la pestaña.</p>}
                    {(tally.skipped + tally.failed) > 0 && (
                        <div className="border border-stone-200 rounded-xl overflow-hidden mb-4">
                            <div className="bg-stone-50 px-3 py-2 text-xs uppercase tracking-wider text-stone-500 flex items-center justify-between"><span>Filas no importadas</span>{importDone && <button onClick={downloadErrors} className="text-teal-600 hover:underline normal-case tracking-normal">Descargar CSV</button>}</div>
                            <div className="max-h-64 overflow-y-auto">
                                {results.filter(r => r.status !== 'created').map(r => (
                                    <div key={r.index} className="px-3 py-1.5 text-sm border-t border-stone-100 flex gap-2"><span className="text-stone-400 w-10 flex-shrink-0">#{r.index + 1}</span><span className="font-medium text-stone-700 w-40 flex-shrink-0 truncate">{r.name}</span><span className={r.status === 'failed' ? 'text-rose-600' : 'text-amber-600'}>{r.message || r.status}</span></div>
                                ))}
                            </div>
                        </div>
                    )}
                    {importDone && (
                        <div className="flex items-center justify-between gap-4">
                            <p className="text-xs text-stone-400">Los posibles duplicados con registros existentes quedan marcados para revisar/fusionar en cada perfil. Reimportar la misma planilla vuelve a crear registros.</p>
                            <button onClick={reset} className="flex-shrink-0 px-5 py-2 text-sm font-semibold text-white bg-teal-600 rounded-xl hover:bg-teal-700">Importar otra planilla</button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// One record row in the confirmation grid: checkbox + summary, expandable to edit.
function RowView({ r, editing, onToggle, onEdit, onChange }: {
    r: { index: number; eff: MappedRow; built: ReturnType<typeof buildImportBody>; selected: boolean };
    editing: boolean; onToggle: () => void; onEdit: () => void; onChange: (p: Partial<MappedRow>) => void;
}) {
    const { eff, built, selected } = r;
    const contacts = [...eff.phones, ...eff.emails, ...eff.socials, ...eff.addresses, ...eff.dnis].join(' · ');
    const invalid = built.errors.length > 0;
    const warned = built.warnings.length > 0;
    // Effective visibility shown to the reviewer: anonymous rows default público,
    // named rows default protegido, unless overridden per-row or in bulk.
    const isAnon = !eff.name?.trim();
    const isPublicEff = eff.isPublic ?? isAnon;
    return (
        <>
            <tr className={`border-t border-stone-100 ${!selected ? 'opacity-40' : ''} ${invalid ? 'bg-rose-50' : ''}`}>
                <td className="px-2 py-2 text-center"><input type="checkbox" checked={selected} onChange={onToggle} /></td>
                <td className="px-3 py-2 font-medium text-stone-800">
                    {/* Empty name is allowed (min-identifier: name OR contact). A
                        nameless-but-valid row shows the muted "Sin nombre" fallback
                        (matching the rest of the app), NOT the red "falta" — that red
                        error label is reserved for a row that is actually invalid
                        (no name AND no contact). */}
                    {eff.name || <span className={`italic ${invalid ? 'text-rose-500' : 'text-stone-400'}`}>{invalid ? 'falta' : 'Sin nombre'}</span>}
                    <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold align-middle ${isPublicEff ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>
                        {isPublicEff ? 'Público' : 'Protegido'}
                    </span>
                </td>
                <td className="px-3 py-2 text-stone-500 max-w-[240px] truncate" title={contacts}>{contacts || '—'}{eff.combinedContacts.length > 0 && <span className="ml-1 text-indigo-500" title="se separará al importar">🧩</span>}</td>
                <td className="px-3 py-2 text-stone-500">
                    {[eff.animalName, eff.species, eff.recordType, eff.rating, eff.date].filter(Boolean).join(' · ') || '—'}
                    {/* Non-blocking warning (unparseable rating/date) — the row still
                        imports; the reviewer can fix the cell in the editor or proceed. */}
                    {warned && <span className="ml-1.5 text-amber-600" title={built.warnings.join(' ')}>⚠</span>}
                </td>
                <td className="px-2 py-2 text-right"><button onClick={onEdit} className="text-stone-400 hover:text-teal-600" title="Editar">✎</button></td>
            </tr>
            {editing && (
                <tr className="bg-stone-50 border-t border-stone-100"><td colSpan={5} className="px-4 py-3">
                    {invalid && <div className="text-xs text-rose-600 mb-2">{built.errors.join(' ')}</div>}
                    {warned && <div className="text-xs text-amber-600 mb-2">{built.warnings.join(' ')} Corregí la fecha/rating abajo, o dejá el registro así (se importa igual).</div>}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        <EditField label="Nombre" value={eff.name} onChange={v => onChange({ name: v })} />
                        <EditField label="Animal" value={eff.animalName ?? ''} onChange={v => onChange({ animalName: v })} />
                        <label className="text-xs text-stone-500">Especie
                            <select value={speciesOptionValue(eff.species)} onChange={e => onChange({ species: e.target.value || undefined })} className="mt-0.5 w-full border border-stone-200 rounded px-2 py-1 text-sm bg-white">
                                {SPECIES_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                            </select>
                        </label>
                        <label className="text-xs text-stone-500">Rating
                            <select value={RATING_OPTIONS.includes(eff.rating ?? '') ? (eff.rating ?? '') : ''} onChange={e => onChange({ rating: e.target.value || undefined })} className="mt-0.5 w-full border border-stone-200 rounded px-2 py-1 text-sm bg-white">
                                <option value="">— (auto)</option>
                                {['1', '2', '3', '4', '5'].map(n => <option key={n} value={n}>{n} ★</option>)}
                            </select>
                        </label>
                        <label className="text-xs text-stone-500">Fecha
                            <input type="date" value={normalizeImportDate(eff.date) ?? ''} onChange={e => onChange({ date: e.target.value || undefined })} className="mt-0.5 w-full border border-stone-200 rounded px-2 py-1 text-sm bg-white" />
                        </label>
                        <label className="text-xs text-stone-500">Tipo
                            <select value={eff.recordType ?? 'adoption'} onChange={e => onChange({ recordType: e.target.value })} className="mt-0.5 w-full border border-stone-200 rounded px-2 py-1 text-sm bg-white">
                                {RECORD_TYPES.map(t => <option key={t} value={t}>{RECORD_TYPE_LABELS[t] ?? t}</option>)}
                            </select>
                        </label>
                        <label className="text-xs text-stone-500">Visibilidad
                            <select value={isPublicEff ? 'public' : 'protected'} onChange={e => onChange({ isPublic: e.target.value === 'public' })} className="mt-0.5 w-full border border-stone-200 rounded px-2 py-1 text-sm bg-white">
                                <option value="public">Público</option>
                                <option value="protected">Protegido</option>
                            </select>
                        </label>
                    </div>
                </td></tr>
            )}
        </>
    );
}

function EditField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
    return (
        <label className="text-xs text-stone-500">{label}
            <input value={value} onChange={e => onChange(e.target.value)} className="mt-0.5 w-full border border-stone-200 rounded px-2 py-1 text-sm" />
        </label>
    );
}
