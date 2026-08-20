'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { parseSpreadsheetFile, type ParsedSheet } from '@/lib/spreadsheetParse';
import { mapImportColumns, interpretRows, aiCleanRowContacts, findAdopters, startImportRun, finishImportRun, importAdoptersBatch, getMyImportRuns, getMyImportRunItems, matchFingerprints, getMatchContext, type DuplicateMatch, type ImportBatchRow, type ImportBatchResult, type EnrichedImportRun, type MatchContext } from '@/app/actions';
import { isExactIdentifierMatch } from '@/domain/importMerge';
import { computeContentFingerprint } from '@/domain/contentFingerprint';
import { formatDateTimeFull } from '@/lib/dates';
import { buildImportBody } from '@/lib/importRow';
import { deserializeContactEntries } from '@/lib/contactEntries';
import { normalizeSpecies, normalizeImportDate, normalizeRating, normalizeRecordType, normalizeNeutered } from '@/domain/importRow';
import {
    TARGET_IMPORT_FIELDS, COMBINED_CONTACT, IGNORE,
    applyColumnMap, emptyMappedRow, guessColumnMap,
    type ColumnMap, type MappedRow,
} from '@/domain/importFields';

// Group an import row's POST-SPLIT contact entries (combined_contact cells are split
// inside buildImportBody) so duplicate detection sees the same contacts that will be
// saved — not the pre-split eff.* arrays (which omit combined_contact values).
function splitGroupedContacts(eff: MappedRow): { phones: string[]; emails: string[]; socials: string[]; ids: string[]; addresses: string[] } {
    const g = { phones: [] as string[], emails: [] as string[], socials: [] as string[], ids: [] as string[], addresses: [] as string[] };
    const built = buildImportBody(eff);
    for (const e of deserializeContactEntries(built.body?.contactEntries ?? '[]')) {
        const v = e.value?.trim(); if (!v) continue;
        if (e.type === 'phone') g.phones.push(v);
        else if (e.type === 'email') g.emails.push(v);
        else if (e.type === 'social') g.socials.push(v);
        else if (e.type === 'id') g.ids.push(v);
        else if (e.type === 'address') g.addresses.push(v);
    }
    return g;
}

type RowStatus = 'created' | 'updated' | 'skipped' | 'failed';
interface RowResult { index: number; name: string; status: RowStatus; message?: string; id?: string }
/** One audited row from a previous run (drill-down on the upload screen). */
interface PrevRunItem {
    id: string; rowIndex: number | null; adopterId: string | null; adopterName: string | null;
    action: string | null; status: string | null; matchedAdopterId: string | null; message: string | null;
}
const PREV_ACTION_LABEL: Record<string, string> = { create: 'Crear', upsert: 'Actualizar', skip: 'Omitir' };
// Inline CSS-var styles (not classNames) — 'created' has no theme-remapped
// Tailwind emerald equivalent (see globals.css --status-emerald-*), and the
// other three are kept as vars too for a single consistent lookup shape.
const PREV_STATUS_STYLE: Record<string, React.CSSProperties> = {
    created: { backgroundColor: 'var(--status-emerald-bg)', color: 'var(--status-emerald-text)' },
    updated: { backgroundColor: 'var(--status-sky-bg)', color: 'var(--status-sky-text)' },
    skipped: { backgroundColor: 'var(--status-warning-bg)', color: 'var(--status-warning-text)' },
    failed: { backgroundColor: 'var(--status-error-bg)', color: 'var(--status-error-text)' },
};
/** Per-row choice on the duplicate-aware import: create a new record, update the
 *  matched existing one (upsert), skip, or (weak matches only) 'review' — an
 *  unresolved default that blocks import until the user picks a real action, so
 *  nothing weak is ever silently created. */
type RowAction = 'create' | 'upsert' | 'skip' | 'review';

/** Snapshot persisted to localStorage so a refresh mid-import can resume. */
interface ResumeSnapshot {
    runId: string; fileName: string; total: number;
    rows: ImportBatchRow[]; names: Record<number, string>;
}
const RESUME_KEY = 'buenadoptante-import-resume-v1';

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
// Map any raw (possibly messy) neutered string onto the 3-way —/Sí/No select
// value via normalizeNeutered (the same normalizer buildImportBody uses), so
// the dropdown reflects what will actually be saved rather than the raw text.
function neuteredOptionValue(raw: string | undefined): string {
    const n = normalizeNeutered(raw);
    return n === 1 ? 'si' : n === 0 ? 'no' : '';
}
// Format a normalized YYYY-MM-DD import date for display WITHOUT constructing a Date
// (new Date("2015-06-01") is UTC-midnight → shows a day early in UTC-negative zones).
const IMPORT_MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function formatImportDate(ymd: string | null): string {
    if (!ymd) return '';
    const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return ymd;
    return `${+m[3]} ${IMPORT_MONTHS_ES[+m[2] - 1]} ${m[1]}`; // e.g. "1 jun 2015"
}

type Step = 'upload' | 'confirm' | 'dedup' | 'import';
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
    // Which single grid cell is in edit mode (perf-critical: only ONE cell across
    // all rows ever renders a live control — everything else renders a static
    // display button — so an 800-row grid stays ~800 buttons, not thousands of
    // live inputs/selects).
    const [editingCell, setEditingCell] = useState<{ index: number; field: string } | null>(null);
    // Import state.
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const [results, setResults] = useState<RowResult[]>([]);
    const [importDone, setImportDone] = useState(false);
    // Cancel: a ref the send-loop checks between batches (state would be stale in
    // the running closure). Already-sent rows persist (idempotent), so a cancel
    // leaves a resumable run rather than half-broken data.
    const cancelRef = useRef(false);
    const [cancelling, setCancelling] = useState(false);
    const [cancelled, setCancelled] = useState(false);
    // ETA: timestamp + row count at the moment sending began, so we can extrapolate
    // the remaining time from the observed rate. A 1s ticker re-renders for a live
    // countdown (progress alone only updates once per batch).
    const importStartRef = useRef<number | null>(null);
    const importStartDoneRef = useRef(0);
    const [, setTick] = useState(0);
    useEffect(() => {
        if (step !== 'import' || importDone) return;
        const id = setInterval(() => setTick(t => t + 1), 1000);
        return () => clearInterval(id);
    }, [step, importDone]);
    // Duplicate-aware import: top existing match per row index (null = checked, no
    // match; absent = not checked yet), and the per-row create/upsert/skip choice.
    const [matches, setMatches] = useState<Record<number, DuplicateMatch | null>>({});
    const [rowAction, setRowAction] = useState<Record<number, RowAction>>({});
    // "Por qué" expansion on the Duplicados triage row: which row (by index) is
    // expanded, and a per-adopterId cache of the presence-only match context so
    // re-expanding a row (or two rows matching the same adopter) never refetches.
    const [expandedMatchRow, setExpandedMatchRow] = useState<number | null>(null);
    const [matchContexts, setMatchContexts] = useState<Record<string, MatchContext | 'loading' | 'error'>>({});
    // Which row's "detalles / más campos" expand (Motivo + secondary animal/adoption
    // fields) is open — same one-row-at-a-time pattern as expandedMatchRow above.
    const [expandedFieldsRow, setExpandedFieldsRow] = useState<number | null>(null);
    // Focus mode (Duplicados step): collapse the grid to just the weak-match rows
    // that still need a decision. `focusWorklist` freezes the set of indices that
    // were unresolved when focus engaged, so resolving a row keeps it visible (its
    // ⚠ badge just clears) instead of dropping out from under the cursor mid-click.
    const [focusPending, setFocusPending] = useState(false);
    const [focusWorklist, setFocusWorklist] = useState<Set<number> | null>(null);
    const [detecting, setDetecting] = useState(false);
    const [detectProgress, setDetectProgress] = useState({ done: 0, total: 0 });
    const [detectionDone, setDetectionDone] = useState(false);
    const [detectionDegraded, setDetectionDegraded] = useState(false);
    // Server failure message per row index (from the last import) — surfaced in the
    // grid so the user can fix the offending field and retry just the failed rows.
    const [failureByIndex, setFailureByIndex] = useState<Record<number, string>>({});
    // A resume snapshot found in localStorage (an import interrupted by a refresh).
    const [resumable, setResumable] = useState<ResumeSnapshot | null>(null);
    useEffect(() => {
        try {
            const raw = localStorage.getItem(RESUME_KEY);
            if (!raw) return;
            const snap = JSON.parse(raw) as ResumeSnapshot;
            if (snap?.runId && Array.isArray(snap.rows) && snap.rows.length > 0) setResumable(snap);
        } catch { /* ignore malformed/blocked storage */ }
    }, []);
    // The user's (and their org's) previous imports, shown on the upload screen.
    const [myRuns, setMyRuns] = useState<EnrichedImportRun[]>([]);
    useEffect(() => { getMyImportRuns().then(setMyRuns).catch(() => setMyRuns([])); }, []);
    // Drill-down: click a previous run to open its records.
    const [expandedRun, setExpandedRun] = useState<string | null>(null);
    const [runItems, setRunItems] = useState<Record<string, PrevRunItem[]>>({});
    const [loadingItems, setLoadingItems] = useState<string | null>(null);
    const toggleRun = async (runId: string) => {
        if (expandedRun === runId) { setExpandedRun(null); return; }
        setExpandedRun(runId);
        if (!runItems[runId]) {
            setLoadingItems(runId);
            try {
                const it = await getMyImportRunItems(runId);
                setRunItems(prev => ({ ...prev, [runId]: it as unknown as PrevRunItem[] }));
            } catch { setRunItems(prev => ({ ...prev, [runId]: [] })); }
            finally { setLoadingItems(null); }
        }
    };

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
    const setOverride = (i: number, patch: Partial<MappedRow>) => {
        setOverrides(o => ({ ...o, [i]: { ...o[i], ...patch } }));
        // Editing a failed row clears its error — it'll be re-evaluated on retry.
        setFailureByIndex(f => { if (!(i in f)) return f; const n = { ...f }; delete n[i]; return n; });
    };
    // Retry the rows the server failed to create (capacity/network — re-sendable).
    // Re-sends JUST those rows with a fresh progress bar + cancel; the server skips
    // any that did get created (idempotent deterministic ids), so this only creates
    // what's missing. Works whether the import was fresh or resumed — it reads the
    // batch rows from the retained snapshot, never the (maybe-absent) parsed grid.
    const retryFailed = async () => {
        const failedIdx = new Set(results.filter(r => r.status === 'failed').map(r => r.index));
        if (!failedIdx.size || !resumable) return;
        const rows = resumable.rows.filter(r => failedIdx.has(r.index));
        if (!rows.length) return;
        cancelRef.current = false; setCancelled(false); setCancelling(false);
        // Keep the full run in view: pass every current result as prior so the results
        // list/final counts don't collapse to just the retried rows. Progress/cancel below
        // track only this retry batch (see sendBatches).
        try { await sendBatches(resumable.runId, rows, [], resumable.names, results); }
        catch (e) {
            setError(e instanceof Error ? e.message : 'La importación se interrumpió.');
            setImportDone(true); setCancelling(false);
        }
    };
    // The original spreadsheet row (header: value · …) for a given record index —
    // shown on the results so a created/failed row is traceable to its source.
    const sourceRowText = (index: number): string => {
        const row = parsed?.rows[index];
        if (!parsed || !row) return '';
        return parsed.headers.map((h, i) => { const v = (row[i] ?? '').toString().trim(); return v ? `${h}: ${v}` : ''; }).filter(Boolean).join(' · ');
    };
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

    // How each selected, importable row will be saved (público vs protegido), so the user
    // sees the consequence BEFORE importing. Mirrors buildBatchRow's rule: explicit
    // per-row/bulk choice wins, else anonymous→público / named→protegido.
    const visibilityCounts = useMemo(() => {
        let publicCount = 0, protectedCount = 0;
        for (const r of importable) {
            if ((rowAction[r.index] ?? 'create') === 'skip') continue;
            const isAnon = !r.eff.name?.trim();
            const pub = r.eff.isPublic !== undefined ? r.eff.isPublic : isAnon;
            if (pub) publicCount++; else protectedCount++;
        }
        return { publicCount, protectedCount };
    }, [importable, rowAction]);

    // What the import will actually DO, so the commit is informed (esp. the auto-upsert rows
    // that mutate existing records). Mirrors buildBatchRow's action resolution.
    const importSummary = useMemo(() => {
        // 'review' rows are unresolved — they're neither a create nor an update yet
        // (the Importar button is disabled until they're resolved), so they're
        // counted separately and excluded from the "a crear" bucket.
        let create = 0, update = 0, skipByAction = 0, review = 0;
        for (const r of importable) {
            const action = rowAction[r.index] ?? 'create';
            if (action === 'upsert') update++;
            else if (action === 'skip') skipByAction++;
            else if (action === 'review') review++;
            else create++;
        }
        return { create, update, review, skipCount: (records.filter(x => x.selected).length - importable.length) + skipByAction };
    }, [importable, rowAction, records]);

    // Look for an existing adopter that matches each selected row, reusing the
    // same duplicate engine the manual form uses (findAdopters, mode 'duplicate').
    // Opt-in (a button), like AI interpretation — 1 lightweight lookup per row,
    // bounded concurrency. Keys on name/phone/email/social (the engine's inputs);
    // address-only / DNI-only rows won't match here and default to "crear".
    const runDetection = async () => {
        const targets = records.filter(r => r.selected);
        setDetecting(true); setDetectionDone(false); setDetectProgress({ done: 0, total: targets.length });
        setDetectionDegraded(false);
        let detectionHadError = false;
        const found: Record<number, DuplicateMatch | null> = {};
        const actions: Record<number, RowAction> = {};

        // Phase 1 — EXACT identical-record match. One server scan fingerprints all
        // existing records and returns which import rows are byte-for-byte the same
        // person (any field combo, incl. address-only). An identical row defaults to
        // "actualizar" — never a duplicate — and skips the fuzzy call below.
        const fpByIndex: Record<number, string> = {};
        for (const t of targets) {
            const g = splitGroupedContacts(t.eff);
            fpByIndex[t.index] = computeContentFingerprint({ name: t.eff.name, ...g });
        }
        const uniqueFps = Array.from(new Set(Object.values(fpByIndex).filter(Boolean)));
        let idMap: Record<string, { adopterId: string; adopterName: string | null }> = {};
        if (uniqueFps.length) {
            const res = await matchFingerprints(uniqueFps).catch(() => ({ ok: false as const, errorId: 'net' }));
            if (res.ok) idMap = res.map;
            else setDetectionDegraded(true); // surfaced in the UI; do NOT treat as "no matches"
        }

        let done = 0, cursor = 0;
        const worker = async () => {
            for (let k = cursor++; k < targets.length; k = cursor++) {
                const { index, eff } = targets[k];
                const idHit = idMap[fpByIndex[index]];
                if (idHit) {
                    found[index] = { adopterId: idHit.adopterId, adopterName: idHit.adopterName ?? '', relevancePercent: 100, matchTypes: ['identical'], matchValues: [], source: 'token' };
                    actions[index] = 'upsert';
                    done++; setDetectProgress({ done, total: targets.length });
                    continue;
                }
                try {
                    // DNIs go via contactInfo, LABELED ("DNI 12345678"), because
                    // findAdopters extracts id_number tokens from contactInfo (there's
                    // no structured `dnis` input) — without this a same-DNI record only
                    // matches on name (~50%) and never counts as an exact identifier.
                    const g = splitGroupedContacts(eff);
                    const res = await findAdopters(
                        {
                            name: eff.name || undefined, phones: g.phones, emails: g.emails, socials: g.socials,
                            contactInfo: g.ids.length ? g.ids.map(d => `DNI ${d}`).join('\n') : undefined,
                        },
                        { mode: 'duplicate', limit: 1, minRelevance: 5 },
                    );
                    const dup = (res.results as DuplicateMatch[]) ?? [];
                    const top = dup[0] ?? null;
                    found[index] = top;
                    // High confidence (exact identifier) defaults to "actualizar"; a
                    // weaker match (e.g. name-only) defaults to 'review' — unresolved,
                    // NOT 'create' — so it can't be silently imported as a duplicate.
                    // No match at all (top === null) isn't shown in triage and imports
                    // as new, so 'create' here is inert.
                    actions[index] = top ? (isExactIdentifierMatch(top.matchTypes) ? 'upsert' : 'review') : 'create';
                } catch {
                    found[index] = null; actions[index] = 'create';
                    detectionHadError = true;
                }
                done++; setDetectProgress({ done, total: targets.length });
            }
        };
        await Promise.all(Array.from({ length: Math.min(5, targets.length) }, worker));
        if (detectionHadError) setDetectionDegraded(true);
        setMatches(found);
        // Seed default actions, but never clobber a choice the user already made.
        setRowAction(prev => { const next = { ...actions }; for (const k of Object.keys(prev)) next[+k] = prev[+k]; return next; });
        setDetecting(false); setDetectionDone(true);
    };

    // Build ONE selected record into a server batch row (client-side: validate +
    // optional AI contact-cleanup). Invalid rows (no name AND no contact) become
    // an immediate 'skipped' result and are never sent. Public default: anonymous
    // rows público, named rows protegido, unless the per-row/bulk toggle overrides.
    const buildBatchRow = async (t: { index: number; eff: MappedRow }): Promise<{ row?: ImportBatchRow; pre?: RowResult; name: string }> => {
        const { index, eff } = t;
        let built = buildImportBody(eff);
        if (built.needsAiCleanup) {
            try { built = buildImportBody(eff, await aiCleanRowContacts(eff.combinedContacts.join('\n'))); } catch { /* keep deterministic */ }
        }
        const match = matches[index];
        const chosen = rowAction[index] ?? 'create';
        // Defensive backstop: the Importar gate already blocks sending while any row
        // is unresolved 'review', but a stray 'review' must NEVER be treated as
        // create here either — map it to 'skip' (import nothing) so nothing weak
        // can reach the server as a create.
        const action: 'create' | 'upsert' | 'skip' = chosen === 'review' ? 'skip' : chosen;
        const name = (action === 'upsert' && match?.adopterName) || built.body?.name || eff.name || `Fila ${index + 1}`;
        if (built.errors.length || !built.body) {
            return { pre: { index, name: eff.name || `Fila ${index + 1}`, status: 'skipped', message: built.errors.join(' ') }, name };
        }
        const isAnon = !eff.name?.trim();
        const isPublic = eff.isPublic !== undefined ? eff.isPublic : isAnon;
        return {
            row: {
                index, action,
                name: built.body.name,
                contactEntries: built.body.contactEntries,
                adoption: built.body.adoption,
                isPublic,
                matchedAdopterId: action === 'upsert' ? (match?.adopterId ?? null) : null,
                matchedAdopterName: match?.adopterName ?? null,
                matchConfidence: match?.relevancePercent ?? null,
            },
            name,
        };
    };

    // Send prebuilt batch rows to the server and finish the run. Shared by a
    // fresh import and a resumed one (after a refresh). Idempotent server-side:
    // rows already created under this runId are no-ops (deterministic ids), so a
    // resume only creates what's missing.
    const sendBatches = async (
        runId: string, toSend: ImportBatchRow[],
        preResults: RowResult[], nameByIndex: Record<number, string>,
        priorResults: RowResult[] = [],
    ) => {
        setStep('import'); setImportDone(false); setFailureByIndex({});
        const acc = new Map<number, RowResult>();
        // Prior results (retry/resume) seed the RESULTS VIEW + final counts so the whole
        // run stays visible; the live result for a re-sent index overwrites its prior entry.
        for (const p of priorResults) acc.set(p.index, p);
        for (const p of preResults) acc.set(p.index, p);
        // Progress + the cancel guard track THIS send operation (toSend + this call's skips),
        // NOT the accumulated run — otherwise a retry seeded with prior results reads as
        // already-100%-done and `done < total` can't detect an interrupted retry.
        const total = toSend.length + preResults.length;
        let done = preResults.length;
        setProgress({ done, total });
        setResults([...acc.values()].sort((a, b) => a.index - b.index));
        importStartRef.current = Date.now();
        importStartDoneRef.current = done; // rows already accounted (skips) don't count toward the rate

        // Send a batch resiliently: try twice, then — if it still throws (a
        // too-heavy batch hitting the Worker CPU/time limit, or a persistent
        // network issue) — SPLIT it in half and retry each half. Idempotent
        // server-side, so re-sending already-created rows is a no-op. This is what
        // stops "el lote falló entero": a heavy batch subdivides until it fits.
        const sendResilient = async (batch: ImportBatchRow[]): Promise<ImportBatchResult[]> => {
            // Cancel mid-flight too: a struggling import (heavy batches retrying and
            // splitting) is exactly when the user hits Cancel — bail out of the retry/
            // split recursion at once. Unprocessed rows stay uncounted and fall to the
            // resume snapshot (idempotent), so nothing is lost or double-created.
            if (cancelRef.current) return [];
            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    const res = await importAdoptersBatch(batch, runId);
                    // A server action can RESOLVE to a non-array (undefined) — not just
                    // throw — when a heavy batch hits the Worker CPU/time limit and the
                    // Worker is killed at the infra level (no app error is logged). Treat
                    // that exactly like a throw: retry, then split, then fail the row —
                    // never let `for…of` on an undefined resolve crash the whole import.
                    if (Array.isArray(res)) return res;
                }
                catch { /* fall through to retry/split */ }
                if (attempt === 0) await new Promise(r => setTimeout(r, 400));
            }
            if (batch.length <= 1) {
                return batch.map(r => ({ index: r.index, status: 'failed' as const, message: 'Falló (posible límite del servidor en una fila pesada).' }));
            }
            const mid = Math.ceil(batch.length / 2);
            const a = await sendResilient(batch.slice(0, mid));
            const b = await sendResilient(batch.slice(mid));
            return [...a, ...b];
        };

        // Smaller initial batches (per-row writes are already low after the token-
        // insert batching) so a batch rarely needs splitting in the first place.
        const BATCH = 12, CONCURRENCY = 2;
        const batches: ImportBatchRow[][] = [];
        for (let i = 0; i < toSend.length; i += BATCH) batches.push(toSend.slice(i, i + BATCH));
        let bcursor = 0;
        const worker = async () => {
            for (let b = bcursor++; b < batches.length; b = bcursor++) {
                if (cancelRef.current) return; // stop pulling new batches on cancel
                const mapped = await sendResilient(batches[b]);
                for (const m of mapped) {
                    acc.set(m.index, { index: m.index, name: nameByIndex[m.index] || `Fila ${m.index + 1}`, status: m.status, id: m.id ?? undefined, message: m.message ?? undefined });
                    done++;
                }
                setProgress({ done, total });
                setResults([...acc.values()].sort((a, b2) => a.index - b2.index));
            }
        };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));

        const finalResults = [...acc.values()].sort((a, b) => a.index - b.index);
        setFailureByIndex(Object.fromEntries(finalResults.filter(r => r.status === 'failed').map(r => [r.index, r.message || 'Falló al importar'])));
        setImportDone(true);
        setCancelling(false);

        // A cancel only "interrupted" the run if work was actually left unsent. If Cancel
        // arrived after the last batch already drained (done >= total), the run is complete —
        // finalize it normally instead of leaving it un-closed and mislabelled 'cancelled'.
        const trulyCancelled = cancelRef.current && done < total;
        if (trulyCancelled) {
            // Cancelled: keep the resume snapshot and leave the run open (interrupted)
            // so the user can reanudar to finish the rest later. Refresh the list so
            // the interrupted run shows up with its "Reanudar" affordance.
            setCancelled(true);
            getMyImportRuns().then(setMyRuns).catch(() => { /* best-effort */ });
            return;
        }
        setCancelled(false);

        // Items are recorded per-batch server-side; here we just close the run.
        const counts = {
            created: finalResults.filter(r => r.status === 'created').length,
            updated: finalResults.filter(r => r.status === 'updated').length,
            skipped: finalResults.filter(r => r.status === 'skipped').length,
            failed: finalResults.filter(r => r.status === 'failed').length,
        };
        // Keep the resume snapshot when rows failed, so "Reintentar" can re-send them;
        // only clear it on a clean run with nothing left to retry.
        if (counts.failed === 0) {
            try { localStorage.removeItem(RESUME_KEY); } catch { /* ignore */ }
            setResumable(null);
        }
        finishImportRun({ runId, counts }).catch(() => { /* audit is best-effort */ });
        getMyImportRuns().then(setMyRuns).catch(() => { /* refresh the previous-runs list */ });
    };

    const runImport = async () => {
        setStep('import'); setImportDone(false); setResults([]); setFailureByIndex({});
        cancelRef.current = false; setCancelled(false); setCancelling(false);
        const targets = records.filter(r => r.selected);
        setProgress({ done: 0, total: targets.length });
        const runId = crypto.randomUUID();
        startImportRun({ runId, source: fileName, total: targets.length }).catch(() => { /* best-effort */ });
        try {
            // Build all rows client-side (validate + AI cleanup). Invalid rows become
            // immediate 'skipped' results and are never sent to the server.
            const preResults: RowResult[] = [];
            const nameByIndex: Record<number, string> = {};
            const toSend: ImportBatchRow[] = [];
            for (const t of targets) {
                const { row, pre, name } = await buildBatchRow(t);
                nameByIndex[t.index] = name;
                if (pre) preResults.push(pre);
                else if (row) toSend.push(row);
            }
            // Persist a resume snapshot so a refresh or a cancel mid-import can pick up
            // where it left off (only the not-yet-created rows re-run — see sendBatches).
            const snapshot: ResumeSnapshot = { runId, fileName, total: targets.length, rows: toSend, names: nameByIndex };
            try { localStorage.setItem(RESUME_KEY, JSON.stringify(snapshot)); } catch { /* quota — resume just won't be available */ }
            setResumable(snapshot);
            await sendBatches(runId, toSend, preResults, nameByIndex);
        } catch (e) {
            // Last-resort terminal state — never leave the screen stuck on "Importando…".
            // Row-level failures are already handled resiliently inside sendBatches.
            setError(e instanceof Error ? e.message : 'La importación se interrumpió.');
            setImportDone(true); setCancelling(false);
        }
    };

    // Cancel: stop pulling new batches. The in-flight batch finishes (idempotent),
    // already-created rows stay, and the run is left resumable.
    const cancelImport = () => { cancelRef.current = true; setCancelling(true); };

    // Resume a run persisted before a refresh/cancel. Re-sends every row; the server
    // skips the ones already created (deterministic ids), so only the missing
    // rows are created.
    const resumeImport = async (snap: ResumeSnapshot) => {
        setResumable(snap); // keep it — a retry after resume re-reads these rows; cleared on a clean finish
        setFileName(snap.fileName); // so the running screen shows the file name on resume too
        cancelRef.current = false; setCancelled(false); setCancelling(false);
        try {
            // On a cancel-resume the current `results` already hold what got created; keep them so
            // resume shows the whole run, not just the re-sent rows. On a refresh-resume `results`
            // is empty (fresh mount) — harmless.
            await sendBatches(snap.runId, snap.rows, [], snap.names, results);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'La importación se interrumpió.');
            setImportDone(true); setCancelling(false);
        }
    };
    const discardResume = () => { try { localStorage.removeItem(RESUME_KEY); } catch { /* ignore */ } setResumable(null); };

    const downloadErrors = () => {
        const bad = results.filter(r => r.status === 'skipped' || r.status === 'failed');
        const csv = ['fila,nombre,estado,motivo', ...bad.map(r => `${r.index + 1},"${(r.name || '').replace(/"/g, '""')}",${r.status},"${(r.message || '').replace(/"/g, '""')}"`)].join('\n');
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        const a = document.createElement('a'); a.href = url; a.download = 'errores-importacion.csv'; a.click(); URL.revokeObjectURL(url);
    };

    const tally = { created: results.filter(r => r.status === 'created').length, updated: results.filter(r => r.status === 'updated').length, skipped: results.filter(r => r.status === 'skipped').length, failed: results.filter(r => r.status === 'failed').length };
    // Estimated time remaining, extrapolated from the observed rate since sending began.
    const etaMs = (() => {
        if (importDone || cancelling || !importStartRef.current) return null;
        const processed = progress.done - importStartDoneRef.current;
        const elapsed = Date.now() - importStartRef.current;
        const remainingRows = progress.total - progress.done;
        if (processed <= 0 || elapsed <= 0 || remainingRows <= 0) return null;
        return Math.round((elapsed / processed) * remainingRows);
    })();
    const fmtEta = (ms: number) => { const s = Math.ceil(ms / 1000); return s < 60 ? `~${s} s` : `~${Math.ceil(s / 60)} min`; };
    const reset = () => { setStep('upload'); setParsed(null); setMap(null); setInterpreted([]); setMode('mapping'); setResults([]); setImportDone(false); setOverrides({}); setDeselected(new Set()); setSearch(''); setFilter('all'); setTypeFilter('all'); setRatingFilter('all'); setMatches({}); setRowAction({}); setDetectionDone(false); setDetectProgress({ done: 0, total: 0 }); setFailureByIndex({}); setExpandedMatchRow(null); setMatchContexts({}); setExpandedFieldsRow(null); setFocusPending(false); setFocusWorklist(null); };

    // Duplicados step (Step 3): the focused triage is ONLY the selected rows that
    // actually matched something — everything else auto-creates, so it never
    // needs the reviewer's attention.
    const matchedRows = records.filter(r => r.selected && matches[r.index]);
    const analyzedCount = records.filter(r => r.selected).length;
    const newCount = analyzedCount - matchedRows.length;
    // Weak matches default to 'review' (unresolved) — count them so the Importar
    // button can be gated and the summary can prompt the user to resolve them.
    const reviewCount = matchedRows.filter(r => (rowAction[r.index] ?? 'create') === 'review').length;
    // Bulk affordance: apply one action to every identical/exact match at once
    // (weaker "possible" matches are left for individual review).
    const applyToAllIdentical = (a: RowAction) => {
        setRowAction(prev => {
            const next = { ...prev };
            for (const row of matchedRows) {
                const m = matches[row.index];
                if (m && (m.matchTypes?.includes('identical') || isExactIdentifierMatch(m.matchTypes))) next[row.index] = a;
            }
            return next;
        });
    };
    // Bulk-resolve every unresolved 'review' row at once — the quick-actions next
    // to the "⚠ N requieren tu decisión" summary line.
    const resolveAllReview = (a: 'create' | 'skip') => {
        setRowAction(prev => {
            const next = { ...prev };
            for (const row of matchedRows) {
                if ((prev[row.index] ?? 'create') === 'review') next[row.index] = a;
            }
            return next;
        });
    };
    // Toggle the "only pending" focus filter. Snapshots the unresolved set on
    // engage so the worklist is frozen while you clear it; clears on disengage.
    const toggleFocusPending = () => {
        setFocusPending(on => {
            const next = !on;
            setFocusWorklist(next
                ? new Set(matchedRows.filter(r => (rowAction[r.index] ?? 'create') === 'review').map(r => r.index))
                : null);
            return next;
        });
    };
    // Rows shown in the Duplicados grid: the frozen worklist when focus is on,
    // otherwise every matched row.
    const dedupVisibleRows = focusPending && focusWorklist
        ? matchedRows.filter(r => focusWorklist.has(r.index))
        : matchedRows;
    // Expand/collapse a triage row's "por qué" panel; fetch the presence-only
    // match context lazily on first expand, cached per adopterId.
    const toggleFieldsExpand = (rowIndex: number) => setExpandedFieldsRow(prev => prev === rowIndex ? null : rowIndex);
    const toggleMatchExpand = (rowIndex: number, adopterId: string) => {
        setExpandedMatchRow(prev => prev === rowIndex ? null : rowIndex);
        if (!(adopterId in matchContexts)) {
            setMatchContexts(prev => ({ ...prev, [adopterId]: 'loading' }));
            getMatchContext(adopterId)
                .then(ctx => setMatchContexts(prev => ({ ...prev, [adopterId]: ctx })))
                .catch(() => setMatchContexts(prev => ({ ...prev, [adopterId]: 'error' })));
        }
    };

    return (
        <div className="max-w-6xl mx-auto p-4">
            <h1 className="text-2xl font-extrabold text-stone-900 mb-1">Importar adopciones desde planilla</h1>
            <p className="text-sm text-stone-500 mb-6">Subí una planilla (CSV o Excel) en cualquier formato; la IA la interpreta y vos validás/editás los registros antes de importar.</p>

            <div className="flex gap-2 mb-6 text-xs font-semibold">
                {(['upload', 'confirm', 'dedup', 'import'] as Step[]).map((s, i) => (
                    <span key={s} className={`px-3 py-1 rounded-full ${step === s ? 'bg-stone-800 text-white' : 'bg-stone-100 text-stone-500'}`}>
                        {i + 1}. {s === 'upload' ? 'Subir' : s === 'confirm' ? 'Revisar' : s === 'dedup' ? 'Duplicados' : 'Importar'}
                    </span>
                ))}
            </div>

            {error && <div className="mb-4 p-3 rounded-lg bg-rose-50 text-rose-700 text-sm border border-rose-200">{error}</div>}

            {step === 'upload' && resumable && (
                <div className="mb-4 p-4 rounded-xl bg-amber-50 border border-amber-200 flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm text-amber-800 min-w-0">
                        <div className="font-semibold">Importación sin terminar</div>
                        <div className="text-amber-700 truncate" title={resumable.fileName}>{resumable.fileName} · {resumable.total} filas. Reanudar crea solo lo que falte (no duplica lo ya creado).</div>
                    </div>
                    <div className="flex-shrink-0 flex gap-2">
                        <button onClick={() => resumeImport(resumable)} className="px-4 py-2 text-sm font-semibold text-white bg-amber-600 rounded-lg hover:bg-amber-700">Reanudar</button>
                        <button onClick={discardResume} className="px-3 py-2 text-sm text-amber-700 hover:bg-amber-100 rounded-lg">Descartar</button>
                    </div>
                </div>
            )}
            {step === 'upload' && (
                <label className="block border-2 border-dashed border-stone-300 rounded-2xl p-12 text-center cursor-pointer hover:border-teal-400 transition-colors">
                    <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
                    <div className="text-4xl mb-2" aria-hidden>📄</div>
                    <div className="font-semibold text-stone-700">{busy ? 'Leyendo…' : 'Elegí un archivo'}</div>
                    <div className="text-xs text-stone-400 mt-1">CSV o Excel (.xlsx)</div>
                </label>
            )}

            {step === 'upload' && myRuns.length > 0 && (
                <div className="mt-6">
                    <div className="text-xs uppercase tracking-wider text-stone-400 mb-2">Importaciones anteriores</div>
                    <div className="border border-stone-200 rounded-xl overflow-hidden">
                        {myRuns.map(run => {
                            const st = run.finishedAt ? 'completa' : (run.lastItemAt && Date.now() / 1000 - run.lastItemAt > 300 ? 'interrumpida' : 'en curso');
                            const stStyle = st === 'completa' ? 'bg-stone-100 text-stone-500' : st === 'interrumpida' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700';
                            // Prefer the per-row audit counts; fall back to the stored header
                            // counters for old runs whose items were never written.
                            const hasItems = run.itemCount > 0;
                            const created = hasItems ? run.dCreated : (run.createdCount ?? 0);
                            const updated = hasItems ? run.dUpdated : (run.updatedCount ?? 0);
                            const skipped = hasItems ? run.dSkipped : (run.skippedCount ?? 0);
                            const failed = hasItems ? run.dFailed : (run.failedCount ?? 0);
                            return (
                                <div key={run.id} className="border-t first:border-t-0 border-stone-100">
                                    <div className="flex items-stretch">
                                        <button type="button" onClick={() => toggleRun(run.id)} aria-expanded={expandedRun === run.id}
                                            className="flex-1 min-w-0 text-left px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm hover:bg-stone-50">
                                            <span className="text-stone-400">{expandedRun === run.id ? '▾' : '▸'}</span>
                                            <span className="text-stone-500">{formatDateTimeFull(run.startedAt ?? '')}</span>
                                            {run.source && <span className="text-xs text-stone-400 truncate max-w-[200px]" title={run.source}>{run.source}</span>}
                                            <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${stStyle}`}>{st}</span>
                                            <span className="ml-auto text-xs text-stone-500 flex flex-wrap gap-x-2 gap-y-0.5 justify-end">
                                                {run.total ? <span className="text-stone-400">{run.total} filas</span> : null}
                                                <span style={{ color: 'var(--status-emerald-text)' }}>{created} creados</span>
                                                {updated > 0 && <span className="text-sky-700">{updated} actualizados</span>}
                                                {skipped > 0 && <span className="text-amber-700">{skipped} omitidos</span>}
                                                {failed > 0 && <span className="text-rose-700">{failed} fallidos</span>}
                                            </span>
                                        </button>
                                        {resumable?.runId === run.id && st !== 'completa' && (
                                            <button type="button" onClick={() => resumeImport(resumable)}
                                                className="flex-shrink-0 px-3 my-1.5 mr-2 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100"
                                                title="Reanudar esta importación (crea solo lo que falte; no duplica lo ya creado)">Reanudar</button>
                                        )}
                                    </div>
                                    {expandedRun === run.id && (
                                        <div className="border-t border-stone-100 bg-stone-50">
                                            {loadingItems === run.id ? (
                                                <div className="px-4 py-3 text-sm text-stone-500">Cargando registros…</div>
                                            ) : (runItems[run.id]?.length ?? 0) === 0 ? (
                                                <div className="px-4 py-3 text-sm text-stone-500">{st === 'en curso' ? 'Corrida en curso o interrumpida — sin registros guardados aún.' : 'Sin registros.'}</div>
                                            ) : (
                                                <div className="max-h-96 overflow-y-auto">
                                                    {runItems[run.id].map(it => (
                                                        <div key={it.id} className="px-4 py-1.5 text-sm border-t first:border-t-0 border-stone-100 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                                            <span className="text-stone-400 w-10 flex-shrink-0">#{it.rowIndex ?? '—'}</span>
                                                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 flex-shrink-0">{PREV_ACTION_LABEL[it.action ?? ''] ?? it.action ?? '—'}</span>
                                                            <span className="font-medium text-stone-800 min-w-0 truncate">
                                                                {it.adopterId
                                                                    ? <a href={`/adopter/${it.adopterId}`} target="_blank" rel="noopener noreferrer" className="text-teal-700 hover:underline">{it.adopterName?.trim() || 'Sin nombre'}</a>
                                                                    : (it.adopterName?.trim() || <span className="italic text-stone-400">Sin nombre</span>)}
                                                            </span>
                                                            {it.status && (
                                                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0"
                                                                    style={PREV_STATUS_STYLE[it.status] ?? { backgroundColor: 'var(--surface-muted)', color: 'var(--text-muted)' }}>
                                                                    {it.status}
                                                                </span>
                                                            )}
                                                            {it.matchedAdopterId && (
                                                                <a href={`/adopter/${it.matchedAdopterId}`} target="_blank" rel="noopener noreferrer" className="text-xs text-teal-700 hover:underline flex-shrink-0">→ registro existente</a>
                                                            )}
                                                            {it.message && <span className="text-xs text-stone-400 min-w-0 truncate">· {it.message}</span>}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
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
                            {/* Rating a todos / Visibilidad a todos now live as compact
                                "· a todos" menus in their column headers, next to the
                                field they act on — see the <thead> below. */}
                            {(filter !== 'all' || typeFilter !== 'all' || ratingFilter !== 'all' || search.trim() !== '') && (
                                <button onClick={() => { setFilter('all'); setTypeFilter('all'); setRatingFilter('all'); setSearch(''); }} className="h-9 px-2 text-sm text-stone-500 hover:text-stone-700">✕ Limpiar filtros</button>
                            )}
                            <span className="text-sm text-stone-500 ml-auto">Mostrando {filtered.length} de {records.length} · {importable.length} se importarán{selectedWarnings > 0 && <span className="text-amber-600"> · {selectedWarnings} con advertencias</span>}{selectedInvalid > 0 && <span className="text-rose-500"> · {selectedInvalid} con errores</span>}</span>
                        </div>
                        {/* Explainer for the visibility toggle above, with a running count so the
                            público/protegido consequence is visible BEFORE importing. */}
                        <p className="text-xs text-stone-500 mt-1">
                            <b style={{ color: 'var(--status-sky-text)' }}>Público</b> = cualquiera puede encontrar este registro al buscar. <b>Protegido</b> = solo vos, tu grupo y administradores.
                            {' '}Se importarán <b style={{ color: 'var(--status-sky-text)' }}>{visibilityCounts.publicCount} públicos</b> y <b className="text-stone-600">{visibilityCounts.protectedCount} protegidos</b>.
                        </p>
                    </div>

                    {/* TODO(wave1c-mobile): reflow to card-per-record ≤sm (single-DOM CSS reflow) */}
                    <RecordGrid rows={filtered}
                        editingCell={editingCell} onEditCell={(index, field) => setEditingCell(field ? { index, field } : null)}
                        matches={matches} rowAction={rowAction} onAction={(index, a) => setRowAction(prev => ({ ...prev, [index]: a }))}
                        failureByIndex={failureByIndex} onToggle={toggle} onChange={setOverride}
                        expandedMatchRow={expandedMatchRow} matchContexts={matchContexts} onToggleWhy={toggleMatchExpand}
                        expandedFieldsRow={expandedFieldsRow} onToggleFields={toggleFieldsExpand}
                        onRatingAll={setRatingAll} onVisibilityAll={setVisibilityAll} />

                    <div className="flex justify-between mt-4">
                        <button onClick={reset} className="px-4 py-2 text-sm text-stone-500 hover:text-stone-700">← Empezar de nuevo</button>
                        <button disabled={importable.length === 0} onClick={() => { setStep('dedup'); runDetection(); }} className="px-5 py-2 text-sm font-semibold text-white bg-teal-600 rounded-xl hover:bg-teal-700 disabled:opacity-40">
                            Continuar a duplicados →
                        </button>
                    </div>
                    </>
                    )}
                </div>
            )}

            {step === 'dedup' && (
                <div>
                    {detecting && (
                        <div className="border border-stone-200 rounded-xl p-6">
                            <div className="text-sm text-teal-700 mb-3 flex items-center gap-2">
                                <span className="inline-block w-4 h-4 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" aria-hidden />
                                Analizando {detectProgress.total} registros contra tu base…
                            </div>
                            <div className="h-2 rounded-full bg-stone-100 overflow-hidden">
                                <div className="h-full bg-teal-500 transition-all" style={{ width: `${detectProgress.total ? (detectProgress.done / detectProgress.total) * 100 : 0}%` }} />
                            </div>
                        </div>
                    )}

                    {!detecting && detectionDone && (
                        <>
                            {/* Summary bar — this IS the folded pre-import confirmation. */}
                            <div className="mb-3 p-3 rounded-lg bg-teal-50 border border-teal-100 text-sm text-teal-800 flex flex-wrap items-center justify-between gap-2">
                                <span className="flex flex-wrap items-center gap-x-1">
                                    <span>🔍 {analyzedCount} analizados · {matchedRows.length} coinciden · {newCount} nuevos ·</span>
                                    <b style={{ color: 'var(--status-emerald-text)' }}>{importSummary.create} a crear</b>
                                    {importSummary.update > 0 && <>· <b className="text-sky-700">{importSummary.update} a actualizar</b></>}
                                    {importSummary.skipCount > 0 && <>· <b className="text-amber-700">{importSummary.skipCount} omitidas</b></>}
                                    <span>· <b style={{ color: 'var(--status-sky-text)' }}>{visibilityCounts.publicCount} públicos</b> · <b className="text-stone-600">{visibilityCounts.protectedCount} protegidos</b></span>
                                </span>
                                <button onClick={runDetection} className="flex-shrink-0 font-semibold text-teal-700 hover:underline">Volver a analizar</button>
                            </div>

                            {detectionDegraded && (
                                <div className="mb-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800 flex flex-wrap items-center justify-between gap-2">
                                    <span>⚠ La búsqueda de duplicados no se completó del todo (error temporal). Algunos registros podrían no haberse comparado — revisá antes de importar.</span>
                                    <button onClick={runDetection} className="flex-shrink-0 font-semibold text-amber-800 underline hover:no-underline">Volver a analizar</button>
                                </div>
                            )}

                            {reviewCount > 0 && (
                                <div className="mb-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800 sticky top-16 z-30 shadow-sm">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <span>⚠ {reviewCount} {reviewCount === 1 ? 'coincidencia requiere' : 'coincidencias requieren'} tu decisión</span>
                                        <div className="flex flex-shrink-0 flex-wrap items-center gap-3">
                                            <button onClick={toggleFocusPending} aria-pressed={focusPending}
                                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-amber-200 font-semibold ${focusPending ? 'bg-amber-100' : ''}`}>
                                                {focusPending ? '◉ Viendo solo pendientes' : `○ Ver solo las pendientes (${reviewCount})`}
                                            </button>
                                            <button onClick={() => resolveAllReview('create')} className="font-semibold text-amber-800 underline hover:no-underline">Crear todas como nuevas</button>
                                            <button onClick={() => resolveAllReview('skip')} className="font-semibold text-amber-800 underline hover:no-underline">Omitir todas</button>
                                        </div>
                                    </div>
                                    <p className="mt-1.5 text-xs text-amber-700">“Actualizar” en bloque solo aplica a coincidencias idénticas (opción “Aplicar a idénticos”, abajo). En estas, cada actualización es una decisión por fila.</p>
                                </div>
                            )}
                            {reviewCount === 0 && focusPending && (
                                <div className="mb-3 p-3 rounded-lg border text-sm sticky top-16 z-30 shadow-sm flex flex-wrap items-center justify-between gap-2"
                                    style={{ backgroundColor: 'var(--status-emerald-bg)', color: 'var(--status-emerald-text)', borderColor: 'var(--status-emerald-text)' }}>
                                    <span>✓ Todas resueltas — listo para importar</span>
                                    <button onClick={toggleFocusPending} className="font-semibold underline hover:no-underline">Ver todas</button>
                                </div>
                            )}

                            {matchedRows.length === 0 && !detectionDegraded ? (
                                <div className="p-4 rounded-xl border border-stone-200 text-sm text-stone-600">
                                    No encontramos duplicados. Los {analyzedCount} registros se crearán como nuevos.
                                </div>
                            ) : matchedRows.length > 0 ? (
                                <>
                                    <div className="mb-3 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 bg-stone-50 border border-stone-200 rounded-xl">
                                        <span className="text-xs uppercase tracking-wider text-stone-500">Coincidencias a decidir · {matchedRows.length}</span>
                                        <label className="flex items-center gap-1.5 text-xs text-stone-500">
                                            Aplicar a todos los idénticos:
                                            <select value="" onChange={e => { const a = e.target.value as RowAction | ''; if (a) applyToAllIdentical(a); }}
                                                className="text-xs border border-stone-200 rounded px-1 py-0.5 bg-white text-stone-600">
                                                <option value="">— elegir —</option>
                                                <option value="upsert">Actualizar</option>
                                                <option value="create">Crear</option>
                                                <option value="skip">Omitir</option>
                                            </select>
                                        </label>
                                    </div>
                                    {/* Same grid/RowView as the Revisar step (see RecordGrid), filtered to just the
                                        matched rows — the match sub-row + "por qué" panel + action toggle live in
                                        RowView, so a matched record shows identically here and in Revisar. */}
                                    <RecordGrid rows={dedupVisibleRows}
                                        editingCell={editingCell} onEditCell={(index, field) => setEditingCell(field ? { index, field } : null)}
                                        matches={matches} rowAction={rowAction} onAction={(index, a) => setRowAction(prev => ({ ...prev, [index]: a }))}
                                        failureByIndex={failureByIndex} onToggle={toggle} onChange={setOverride}
                                        expandedMatchRow={expandedMatchRow} matchContexts={matchContexts} onToggleWhy={toggleMatchExpand}
                                        expandedFieldsRow={expandedFieldsRow} onToggleFields={toggleFieldsExpand}
                                        onRatingAll={setRatingAll} onVisibilityAll={setVisibilityAll} />
                                </>
                            ) : null}

                            <div className="flex items-center justify-between mt-4">
                                <button onClick={() => setStep('confirm')} className="px-4 py-2 text-sm text-stone-500 hover:text-stone-700">← Volver a revisar</button>
                                <div className="flex items-center gap-3">
                                    <span className="text-xs text-stone-400">Los {newCount} se crearán como nuevos</span>
                                    <button disabled={importable.length === 0 || reviewCount > 0} onClick={runImport}
                                        title={reviewCount > 0 ? `Resolvé las ${reviewCount} coincidencias marcadas primero` : undefined}
                                        className="px-5 py-2 text-sm font-semibold text-white bg-teal-600 rounded-xl hover:bg-teal-700 disabled:opacity-40">
                                        Importar {importable.length} →
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}

            {step === 'import' && (
                <div>
                    <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                        <span className="font-semibold text-stone-700">
                            {importDone ? (cancelled ? 'Importación cancelada' : 'Importación completa') : (cancelling ? 'Cancelando…' : 'Importando…')}
                        </span>
                        <div className="flex items-center gap-3">
                            <span className="text-stone-500">
                                {progress.done} / {progress.total}
                                {etaMs != null && <span className="text-stone-400"> · {fmtEta(etaMs)} restante</span>}
                            </span>
                            {!importDone && (
                                <button onClick={cancelImport} disabled={cancelling}
                                    className="px-3 py-1 text-xs font-semibold text-stone-600 bg-stone-100 rounded-lg hover:bg-stone-200 disabled:opacity-50"
                                    title="Frena el envío. Lo ya creado se conserva y podés reanudar para completar el resto.">
                                    {cancelling ? 'Cancelando…' : 'Cancelar'}
                                </button>
                            )}
                        </div>
                    </div>
                    {fileName && <div className="text-xs text-stone-400 mb-3 truncate" title={fileName}><span aria-hidden>📄</span> {fileName}</div>}
                    <div className="h-3 rounded-full bg-stone-100 overflow-hidden mb-4"><div className="h-full bg-teal-500 transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /></div>
                    <div className="flex gap-3 mb-4 text-sm">
                        <span className="px-3 py-1 rounded-lg font-medium" style={{ backgroundColor: 'var(--status-emerald-bg)', color: 'var(--status-emerald-text)' }}>✅ {tally.created} creados</span>
                        {tally.updated > 0 && <span className="px-3 py-1 rounded-lg bg-sky-50 text-sky-700 font-medium">↻ {tally.updated} actualizados</span>}
                        <span className="px-3 py-1 rounded-lg bg-amber-50 text-amber-700 font-medium">⏭️ {tally.skipped} omitidos</span>
                        <span className="px-3 py-1 rounded-lg bg-rose-50 text-rose-700 font-medium">⚠️ {tally.failed} fallidos</span>
                    </div>
                    {!importDone && <p className="text-xs text-stone-400 mb-4">Puede tardar unos minutos (cada fila se verifica y tokeniza). No cierres la pestaña.</p>}
                    {(tally.skipped + tally.failed) > 0 && (
                        <div className="border border-stone-200 rounded-xl overflow-hidden mb-4">
                            <div className="bg-stone-50 px-3 py-2 text-xs uppercase tracking-wider text-stone-500 flex items-center justify-between"><span>Filas no importadas</span>{importDone && <button onClick={downloadErrors} className="text-teal-600 hover:underline normal-case tracking-normal">Descargar CSV</button>}</div>
                            <div className="max-h-64 overflow-y-auto">
                                {results.filter(r => r.status === 'skipped' || r.status === 'failed').map(r => (
                                    <div key={r.index} className="px-3 py-1.5 text-sm border-t border-stone-100">
                                        <div className="flex gap-2">
                                            <span className="text-stone-400 w-10 flex-shrink-0">#{r.index + 1}</span>
                                            <span className="font-medium text-stone-700 w-40 flex-shrink-0 truncate">{r.name}</span>
                                            <span className={`min-w-0 ${r.status === 'failed' ? 'text-rose-600' : 'text-amber-600'}`}>{r.message || r.status}</span>
                                        </div>
                                        {sourceRowText(r.index) && <div className="text-[11px] text-stone-400 truncate pl-12" title={sourceRowText(r.index)}>{sourceRowText(r.index)}</div>}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    {importDone && (tally.created + tally.updated) > 0 && (
                        <div className="border border-stone-200 rounded-xl overflow-hidden mb-4">
                            <div className="px-3 py-2 text-xs uppercase tracking-wider" style={{ backgroundColor: 'var(--status-emerald-bg)', color: 'var(--status-emerald-text)' }}>Registros creados ({tally.created}){tally.updated > 0 && ` y actualizados (${tally.updated})`} — revisalos</div>
                            <div className="max-h-72 overflow-y-auto">
                                {results.filter(r => r.status === 'created' || r.status === 'updated').map(r => (
                                    <div key={r.index} className="px-3 py-1.5 text-sm border-t border-stone-100">
                                        <div className="flex gap-2 items-center">
                                            <span className="text-stone-400 w-10 flex-shrink-0">#{r.index + 1}</span>
                                            <span className="flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded"
                                                style={r.status === 'updated'
                                                    ? { backgroundColor: 'var(--status-sky-bg)', color: 'var(--status-sky-text)' }
                                                    : { backgroundColor: 'var(--status-emerald-bg)', color: 'var(--status-emerald-text)' }}>
                                                {r.status === 'updated' ? 'actualizado' : 'creado'}
                                            </span>
                                            <span className="font-medium text-stone-700 flex-1 truncate">{/^Fila \d+$/.test(r.name) ? <span className="italic text-stone-400">Sin nombre</span> : r.name}{r.status === 'updated' && r.message && <span className="text-stone-400 font-normal"> · {r.message}</span>}</span>
                                            {r.id
                                                ? <a href={`/adopter/${r.id}`} target="_blank" rel="noopener noreferrer" className="flex-shrink-0 text-teal-600 hover:underline">Ver perfil →</a>
                                                : <span className="flex-shrink-0 text-stone-400">{r.status === 'updated' ? 'actualizado' : 'creado'}</span>}
                                        </div>
                                        {sourceRowText(r.index) && <div className="text-[11px] text-stone-400 truncate pl-12" title={sourceRowText(r.index)}>{sourceRowText(r.index)}</div>}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    {importDone && (
                        <div className="flex items-center justify-between gap-4">
                            <p className="text-xs text-stone-400">
                                {cancelled
                                    ? 'Cancelaste la importación. Lo ya creado quedó guardado — reanudá para crear las filas restantes (no duplica lo ya creado).'
                                    : 'Los posibles duplicados con registros existentes quedan marcados para revisar/fusionar en cada perfil. Reimportar la misma planilla vuelve a crear registros.'}
                            </p>
                            <div className="flex-shrink-0 flex items-center gap-2">
                                {cancelled && resumable && (
                                    <button onClick={() => resumeImport(resumable)} className="px-4 py-2 text-sm font-semibold text-white bg-amber-600 rounded-xl hover:bg-amber-700">Reanudar y completar</button>
                                )}
                                {tally.failed > 0 && resumable && (
                                    <button onClick={retryFailed} className="px-4 py-2 text-sm font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl hover:bg-rose-100" title="Reenvía solo las filas fallidas (no duplica lo ya creado). Muestra progreso y podés cancelar.">↻ Reintentar {tally.failed} fallida{tally.failed > 1 ? 's' : ''}</button>
                                )}
                                <button onClick={reset} className="px-5 py-2 text-sm font-semibold text-white bg-teal-600 rounded-xl hover:bg-teal-700">Importar otra planilla</button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// One record row in the confirmation grid: checkbox + summary, expandable to edit.
const MATCH_TYPE_LABELS: Record<string, string> = {
    identical: 'todos los datos',
    phone: 'teléfono', phone_suffix: 'teléfono', like_fallback_contact: 'teléfono',
    email: 'email', social: 'red social', id_number: 'DNI', address_word: 'dirección',
    name_full: 'nombre', name_word: 'nombre', name_phonetic: 'nombre', name_word_fuzzy: 'nombre', like_fallback_name: 'nombre',
};
function matchTypeLabels(types: string[]): string {
    const labels = [...new Set(types.map(t => MATCH_TYPE_LABELS[t]).filter(Boolean))];
    return labels.length ? labels.join(', ') : 'datos';
}
// Signal-type groups used by explainMatchOneLiner below (same token vocabulary
// isExactIdentifierMatch checks, plus the name-ish family it's compared against).
const NAME_SIGNAL_TYPES = new Set(['name_full', 'name_word', 'name_phonetic', 'name_word_fuzzy', 'like_fallback_name']);
const STRONG_SIGNAL_TYPES = new Set(['phone', 'phone_suffix', 'like_fallback_contact', 'email', 'id_number', 'social']);

// One-line, derived explanation of WHY a row matched — composed from the matched
// signal types plus the existing record's presence-only context (never its values).
function explainMatchOneLiner(match: DuplicateMatch, ctx: MatchContext | undefined): string {
    const pct = match.relevancePercent;
    if (match.matchTypes?.includes('identical')) return 'Coincide en todos los datos — prácticamente seguro que es la misma persona.';
    const nameOnly = match.matchTypes.length > 0 && match.matchTypes.every(t => NAME_SIGNAL_TYPES.has(t));
    if (nameOnly) {
        if (ctx?.ok && !ctx.has.phone && !ctx.has.email) {
            return `Coincide solo en el nombre (${pct}%). El registro existente no tiene teléfono ni email para comparar — podría ser otra persona con el mismo nombre.`;
        }
        return `Coincide solo en el nombre (${pct}%) — revisá el contacto antes de decidir.`;
    }
    const strongLabels = [...new Set(match.matchTypes.filter(t => STRONG_SIGNAL_TYPES.has(t)).map(t => MATCH_TYPE_LABELS[t]).filter(Boolean))];
    if (strongLabels.length) {
        const hasName = match.matchTypes.some(t => NAME_SIGNAL_TYPES.has(t));
        return hasName
            ? `Coincide en nombre y ${strongLabels.join(', ')} (${pct}%).`
            : `Coincide en ${strongLabels.join(', ')} (${pct}%).`;
    }
    return `Coincide en ${matchTypeLabels(match.matchTypes)} (${pct}%).`;
}

// Presence-only badges for the EXISTING record — never renders the actual value,
// only whether that contact TYPE is present (the record may be protected/another
// org's). Themed colors only: sky = present, stone = absent.
function PresenceBadges({ has }: { has: MatchContext['has'] }) {
    const items: Array<[boolean, string]> = [
        [has.phone, 'teléfono'], [has.email, 'email'], [has.id, 'DNI'], [has.social, 'red'], [has.address, 'dirección'],
    ];
    return (
        <div className="flex flex-wrap gap-1">
            {items.map(([present, label]) => (
                <span key={label} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${present ? 'bg-sky-50 text-sky-700' : 'bg-stone-100 text-stone-400'}`}>
                    {present ? '✓' : '·'} {label}
                </span>
            ))}
        </div>
    );
}

// Shared match badge — used both in the confirm grid's inline sub-row (RowView)
// and the Duplicados triage list, so the ● Idéntico/○ Posible copy never drifts.
function MatchBadge({ match, isExact }: { match: DuplicateMatch; isExact: boolean }) {
    const identical = match.matchTypes?.includes('identical');
    const strong = identical || isExact;
    return (
        <span className={strong ? 'text-sky-800' : 'text-stone-600'}>
            {identical ? '● Idéntico a' : isExact ? '● Duplicado de' : '○ Posible duplicado de'} <span className="font-semibold">{match.adopterName?.trim() || 'Sin nombre'}</span>
            <span className="text-stone-500"> · {identical ? 'mismos datos' : `${match.relevancePercent}% · coincide en ${matchTypeLabels(match.matchTypes)}`}</span>
        </span>
    );
}

// Shared Actualizar/Crear/Omitir segmented control — same two call sites as MatchBadge.
// A 'review' action (weak match, unresolved default) highlights NONE of the three
// segments and shows an amber "⚠ Elegí" hint — picking any segment resolves it.
function ActionToggle({ action, onAction }: { action: RowAction; onAction: (a: RowAction) => void }) {
    return (
        <div className="inline-flex items-center gap-1.5">
            <div className="inline-flex rounded-lg border border-stone-200 overflow-hidden">
                {(['upsert', 'create', 'skip'] as const).map(a => (
                    <button key={a} type="button" onClick={() => onAction(a)}
                        className={`px-2 py-0.5 ${action === a ? 'bg-teal-600 text-white' : 'bg-white text-stone-600 hover:bg-stone-50'}`}
                        title={a === 'upsert' ? 'Actualizar el registro existente (merge aditivo)' : a === 'create' ? 'Crear un registro nuevo igual' : 'No importar esta fila'}>
                        {a === 'upsert' ? 'Actualizar' : a === 'create' ? 'Crear' : 'Omitir'}
                    </button>
                ))}
            </div>
            {action === 'review' && <span className="text-amber-600 text-xs font-semibold whitespace-nowrap">⚠ Elegí</span>}
        </div>
    );
}

function RowView({ r, editingField, onEditCell, match, action, onAction, failure, onToggle, onChange, expanded, onToggleWhy, matchContext, fieldsExpanded, onToggleFields }: {
    r: { index: number; eff: MappedRow; built: ReturnType<typeof buildImportBody>; selected: boolean };
    editingField: string | null; onEditCell: (field: string | null) => void;
    match?: DuplicateMatch | null; action: RowAction; onAction: (a: RowAction) => void;
    failure?: string; onToggle: () => void; onChange: (p: Partial<MappedRow>) => void;
    // "Por qué" expansion on the match sub-row below — expand state, the toggle
    // handler, and the (lazily fetched, parent-cached) presence-only context for
    // THIS row's match.adopterId. Parent owns the fetch (getMatchContext); RowView
    // only renders what it's given.
    expanded?: boolean; onToggleWhy?: () => void; matchContext?: MatchContext | 'loading' | 'error';
    // "Motivo / más campos" expand — the Motivo cell toggles this sub-row, which
    // exposes the free-text details textarea + the secondary animal/adoption fields
    // (onBehalfOf/sex/color/microchip/age/neutered) that are otherwise hidden.
    fieldsExpanded?: boolean; onToggleFields?: () => void;
}) {
    const { eff, built, selected } = r;
    const isExact = match ? isExactIdentifierMatch(match.matchTypes) : false;
    const contactChips: Array<{ t: string; v: string }> = [
        ...eff.phones.map(v => ({ t: 'Tel', v })),
        ...eff.emails.map(v => ({ t: 'Email', v })),
        ...eff.socials.map(v => ({ t: 'Red', v })),
        ...eff.dnis.map(v => ({ t: 'DNI', v })),
        ...eff.addresses.map(v => ({ t: 'Dir', v })),
    ];
    const invalid = built.errors.length > 0;
    const warned = built.warnings.length > 0;
    const hasIssue = invalid || warned || !!failure;
    // Effective visibility shown to the reviewer: anonymous rows default público,
    // named rows default protegido, unless overridden per-row or in bulk.
    // PRODUCT: anon-rows-default-to-público is the intended showcase behavior today;
    // flipping this default to protected-by-default is a product decision, not made here.
    const isAnon = !eff.name?.trim();
    const isPublicEff = eff.isPublic ?? isAnon;

    // Translated/human-readable display values (the whole point of this grid: every
    // field visible + readable without expanding a row).
    const speciesVal = speciesOptionValue(eff.species);
    const speciesLabel = speciesVal ? (SPECIES_OPTIONS.find(o => o.v === speciesVal)?.l ?? '—') : '—';
    const typeVal = normalizeRecordType(eff.recordType);
    const typeLabel = RECORD_TYPE_LABELS[typeVal] ?? typeVal;
    const ratingNorm = normalizeRating(eff.rating);
    const normDate = normalizeImportDate(eff.date);
    const dateUnparseable = !normDate && !!eff.date;

    // Small helper so every field-cell wires the same active/activate/deactivate
    // triple against the lifted editingCell state (see the parent's setEditingCell).
    const cellProps = (field: string) => ({
        active: editingField === field,
        onActivate: () => onEditCell(field),
        onDeactivate: () => onEditCell(null),
    });

    // Motivo (eff.details) is shown FULL and un-trimmed in the interaction line
    // (never a truncated column value). It clamps to 2 lines with a per-row
    // "ver motivo completo" toggle when long — a local flag is enough here since,
    // unlike editingCell, only one row's own clamp state is ever relevant at a time.
    const [motivoExpanded, setMotivoExpanded] = useState(false);
    const isLongMotivo = (eff.details?.length ?? 0) > 120;
    const motivoEditing = editingField === 'details';

    return (
        <>
            <tr className={`border-t border-stone-100 ${!selected ? 'opacity-40' : ''} ${(invalid || failure) ? 'bg-rose-50' : ''}`}>
                <td className="px-2 py-2 text-center"><input type="checkbox" checked={selected} onChange={onToggle} aria-label="Seleccionar fila" /></td>
                <td className="px-2 py-2 text-right text-stone-400 text-xs tabular-nums whitespace-nowrap align-top">{r.index + 1}</td>
                <td className="px-3 py-2 font-medium text-stone-800">
                    <InlineCell {...cellProps('name')} kind="text" ariaLabel="Editar nombre"
                        value={eff.name} onCommit={v => onChange({ name: v })}
                        display={
                            /* Empty name is allowed (min-identifier: name OR contact). A
                               nameless-but-valid row shows the muted "Sin nombre" fallback
                               (matching the rest of the app), NOT the red "falta" — that red
                               error label is reserved for a row that is actually invalid
                               (no name AND no contact). */
                            eff.name
                                ? <span className="block truncate max-w-[150px]" title={eff.name}>{eff.name}</span>
                                : <span className={`italic ${invalid ? 'text-rose-500' : 'text-stone-400'}`}>{invalid ? 'falta' : 'Sin nombre'}</span>
                        } />
                </td>
                <td className="px-3 py-2 align-top">
                    {contactChips.length === 0 && eff.combinedContacts.length === 0 ? (
                        <span className="text-stone-400">—</span>
                    ) : (
                        <div className="flex flex-wrap gap-1 max-w-[210px]">
                            {contactChips.map((c, i) => (
                                <span key={i} className="inline-flex items-center gap-1 max-w-full text-xs bg-stone-100 rounded px-1.5 py-0.5" title={`${c.t}: ${c.v}`}>
                                    <span className="text-[9px] uppercase font-semibold text-stone-400 flex-shrink-0">{c.t}</span>
                                    <span className="text-stone-700 truncate">{c.v}</span>
                                </span>
                            ))}
                            {eff.combinedContacts.length > 0 && (
                                <span className="inline-flex items-center text-indigo-600 self-center" title="se separará al importar">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                                    </svg>
                                </span>
                            )}
                        </div>
                    )}
                </td>
                <td className="px-3 py-2">
                    <InlineCell {...cellProps('isPublic')} kind="select" ariaLabel="Editar visibilidad"
                        value={isPublicEff ? 'public' : 'protected'}
                        options={[{ value: 'public', label: 'Público' }, { value: 'protected', label: 'Protegido' }]}
                        onCommit={v => onChange({ isPublic: v === 'public' })}
                        display={
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                                style={isPublicEff
                                    ? { backgroundColor: 'var(--status-sky-bg)', color: 'var(--status-sky-text)' }
                                    : { backgroundColor: 'var(--surface-muted)', color: 'var(--text-muted)' }}>
                                {isPublicEff ? 'Público' : 'Protegido'}
                            </span>
                        } />
                </td>
            </tr>
            {/* Interaction line — ALWAYS visible under every identity row (this is
                the record: Tipo/animal/especie/rating/fecha + the full Motivo, never
                trimmed to a column). Each meta field reuses InlineCell + the SAME
                lifted editingCell state as the identity row, so only one control is
                ever live across the whole grid. */}
            <tr className={!selected ? 'opacity-40' : ''}>
                <td></td>
                <td colSpan={4} className="px-3 pb-2">
                    <div className="border-l-2 border-amber-200 bg-stone-50 rounded-r-lg px-3 py-2">
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-stone-600">
                            <InlineCell {...cellProps('recordType')} inline kind="select" ariaLabel="Editar tipo"
                                value={typeVal} options={RECORD_TYPES.map(t => ({ value: t, label: RECORD_TYPE_LABELS[t] ?? t }))}
                                onCommit={v => onChange({ recordType: v })}
                                display={<span className="font-semibold text-stone-700">{typeLabel}</span>} />
                            <span>·</span>
                            <span aria-hidden>🐾</span>
                            <InlineCell {...cellProps('animalName')} inline kind="text" ariaLabel="Editar animal"
                                value={eff.animalName ?? ''} onCommit={v => onChange({ animalName: v })}
                                display={
                                    eff.animalName
                                        ? <span className="truncate max-w-[110px] inline-block align-bottom" title={eff.animalName}>{eff.animalName}</span>
                                        : <span className="text-stone-400">sin animal</span>
                                } />
                            <span>·</span>
                            <InlineCell {...cellProps('species')} inline kind="select" ariaLabel="Editar especie"
                                value={speciesVal} options={SPECIES_OPTIONS.map(o => ({ value: o.v, label: o.l }))}
                                onCommit={v => onChange({ species: v || undefined })}
                                display={speciesVal ? speciesLabel : <span className="text-stone-400">sin especie</span>} />
                            <span>·</span>
                            <InlineCell {...cellProps('rating')} inline kind="select" ariaLabel="Editar rating"
                                value={RATING_OPTIONS.includes(eff.rating ?? '') ? (eff.rating ?? '') : ''}
                                options={[{ value: '', label: '— (auto)' }, ...['1', '2', '3', '4', '5'].map(n => ({ value: n, label: `${n} ★` }))]}
                                onCommit={v => onChange({ rating: v || undefined })}
                                display={ratingNorm != null ? <span className="text-amber-700 font-medium">{'★'.repeat(ratingNorm)}</span> : <span className="text-stone-400">sin rating</span>} />
                            <span>·</span>
                            <InlineCell {...cellProps('date')} inline kind="date" ariaLabel="Editar fecha"
                                value={normDate ?? ''} onCommit={v => onChange({ date: v || undefined })}
                                display={
                                    normDate ? formatImportDate(normDate)
                                        : dateUnparseable ? <span className="text-amber-700">{eff.date} <span title={built.warnings.join(' ')}>⚠</span></span>
                                            : <span className="text-stone-400">sin fecha</span>
                                } />
                            <button type="button" onClick={onToggleFields} aria-expanded={!!fieldsExpanded}
                                className="ml-auto flex-shrink-0 text-teal-700 hover:underline">
                                {fieldsExpanded ? 'ocultar más datos' : 'más datos'}
                            </button>
                        </div>
                        <div className="mt-1.5 text-sm">
                            {motivoEditing ? (
                                <textarea autoFocus rows={3} defaultValue={eff.details ?? ''}
                                    aria-label="Editar motivo"
                                    onBlur={e => { onChange({ details: e.target.value || undefined }); onEditCell(null); }}
                                    onKeyDown={e => { if (e.key === 'Escape') onEditCell(null); }}
                                    placeholder="Motivo por el que se registra / notas"
                                    className="w-full border border-stone-200 rounded px-2 py-1 text-sm bg-white" />
                            ) : eff.details ? (
                                <div className="text-stone-700">
                                    <p className={`whitespace-pre-wrap cursor-text rounded px-1 -mx-1 ${motivoExpanded ? '' : 'line-clamp-2'}`}
                                        onClick={() => onEditCell('details')} title="Click para editar">
                                        {eff.details}
                                    </p>
                                    {isLongMotivo && (
                                        <button type="button" onClick={() => setMotivoExpanded(v => !v)} className="mt-0.5 text-xs text-teal-700 hover:underline">
                                            {motivoExpanded ? 'ver menos' : 'ver motivo completo'}
                                        </button>
                                    )}
                                </div>
                            ) : (
                                <button type="button" onClick={() => onEditCell('details')} className="text-left text-stone-400 italic">
                                    — sin motivo (click para agregar)
                                </button>
                            )}
                        </div>
                    </div>
                </td>
            </tr>
            {fieldsExpanded && (
                <tr className={!selected ? 'opacity-40' : ''}>
                    <td></td>
                    <td colSpan={4} className="px-3 pb-2">
                        <div className="rounded-lg border border-stone-200 p-3 text-xs" style={{ backgroundColor: 'var(--surface-muted)' }}>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                <div>
                                    <label htmlFor={`obo-${r.index}`} className="block text-stone-400 uppercase tracking-wider text-[10px] mb-1">En nombre de</label>
                                    <input id={`obo-${r.index}`} type="text" value={eff.onBehalfOf ?? ''}
                                        onChange={e => onChange({ onBehalfOf: e.target.value || undefined })}
                                        className="w-full border border-stone-200 rounded px-2 py-1 text-sm bg-white" />
                                </div>
                                <div>
                                    <label htmlFor={`sex-${r.index}`} className="block text-stone-400 uppercase tracking-wider text-[10px] mb-1">Sexo</label>
                                    <input id={`sex-${r.index}`} type="text" value={eff.sex ?? ''}
                                        onChange={e => onChange({ sex: e.target.value || undefined })}
                                        className="w-full border border-stone-200 rounded px-2 py-1 text-sm bg-white" />
                                </div>
                                <div>
                                    <label htmlFor={`color-${r.index}`} className="block text-stone-400 uppercase tracking-wider text-[10px] mb-1">Color</label>
                                    <input id={`color-${r.index}`} type="text" value={eff.color ?? ''}
                                        onChange={e => onChange({ color: e.target.value || undefined })}
                                        className="w-full border border-stone-200 rounded px-2 py-1 text-sm bg-white" />
                                </div>
                                <div>
                                    <label htmlFor={`microchip-${r.index}`} className="block text-stone-400 uppercase tracking-wider text-[10px] mb-1">Microchip</label>
                                    <input id={`microchip-${r.index}`} type="text" value={eff.microchip ?? ''}
                                        onChange={e => onChange({ microchip: e.target.value || undefined })}
                                        className="w-full border border-stone-200 rounded px-2 py-1 text-sm bg-white" />
                                </div>
                                <div>
                                    <label htmlFor={`age-${r.index}`} className="block text-stone-400 uppercase tracking-wider text-[10px] mb-1">Edad</label>
                                    <input id={`age-${r.index}`} type="text" value={eff.age ?? ''}
                                        onChange={e => onChange({ age: e.target.value || undefined })}
                                        className="w-full border border-stone-200 rounded px-2 py-1 text-sm bg-white" />
                                </div>
                                <div>
                                    <label htmlFor={`neutered-${r.index}`} className="block text-stone-400 uppercase tracking-wider text-[10px] mb-1">Castrado/a</label>
                                    <select id={`neutered-${r.index}`} value={neuteredOptionValue(eff.neutered)}
                                        onChange={e => onChange({ neutered: e.target.value || undefined })}
                                        className="w-full border border-stone-200 rounded px-2 py-1 text-sm bg-white">
                                        <option value="">—</option>
                                        <option value="si">Sí</option>
                                        <option value="no">No</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                    </td>
                </tr>
            )}
            {match && (
                <>
                    <tr className={!selected ? 'opacity-40' : ''}>
                        <td></td>
                        <td colSpan={4} className="px-3 pb-2">
                            <div className="flex flex-wrap items-center gap-2 text-xs bg-sky-50 border border-stone-200 rounded-lg px-2.5 py-1.5">
                                {onToggleWhy && (
                                    <button type="button" onClick={onToggleWhy}
                                        aria-expanded={expanded} aria-label="Ver por qué coincidió"
                                        className="text-stone-400 hover:text-stone-600 flex-shrink-0 w-4 text-center">{expanded ? '▾' : '▸'}</button>
                                )}
                                <MatchBadge match={match} isExact={isExact} />
                                <button type="button" onClick={() => window.open(`/adopter/${match.adopterId}`, '_blank', 'noopener,noreferrer')} className="text-teal-700 hover:underline">Abrir ↗</button>
                                <div className="ml-auto"><ActionToggle action={action} onAction={onAction} /></div>
                            </div>
                        </td>
                    </tr>
                    {expanded && (
                        <tr className={!selected ? 'opacity-40' : ''}>
                            <td></td>
                            <td colSpan={4} className="px-3 pb-2">
                                <div className="rounded-lg border border-stone-200 p-3 text-xs space-y-2.5" style={{ backgroundColor: 'var(--surface-muted)' }}>
                                    <div>
                                        <span className="text-stone-500">Coincidió en: </span>
                                        <span className="font-medium text-stone-700">{matchTypeLabels(match.matchTypes)}</span>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div>
                                            <div className="text-stone-400 uppercase tracking-wider text-[10px] mb-1">Tu registro (importado)</div>
                                            <div className="font-medium text-stone-800 mb-1">{eff.name || <span className="italic text-stone-400">Sin nombre</span>}</div>
                                            {contactChips.length > 0 ? (
                                                <div className="flex flex-wrap gap-1">
                                                    {contactChips.map((c, i) => (
                                                        <span key={i} className="inline-flex items-center gap-1 text-[10px] bg-stone-100 rounded px-1.5 py-0.5 max-w-full">
                                                            <span className="uppercase font-semibold text-stone-400 flex-shrink-0">{c.t}</span>
                                                            <span className="text-stone-700 truncate">{c.v}</span>
                                                        </span>
                                                    ))}
                                                </div>
                                            ) : <span className="text-stone-400">Sin contacto</span>}
                                        </div>
                                        <div>
                                            <div className="text-stone-400 uppercase tracking-wider text-[10px] mb-1">Registro existente</div>
                                            <div className="font-medium text-stone-800 mb-1">{match.adopterName?.trim() || 'Sin nombre'}</div>
                                            {matchContext === undefined || matchContext === 'loading' ? (
                                                <span className="text-stone-400">Cargando…</span>
                                            ) : matchContext === 'error' || !matchContext.ok ? (
                                                <button type="button" onClick={() => window.open(`/adopter/${match.adopterId}`, '_blank', 'noopener,noreferrer')} className="text-teal-700 hover:underline">Abrir ↗</button>
                                            ) : (
                                                <PresenceBadges has={matchContext.has} />
                                            )}
                                        </div>
                                    </div>
                                    <div className="pt-1 border-t border-stone-200 text-stone-600">
                                        {explainMatchOneLiner(match, matchContext === 'loading' || matchContext === 'error' ? undefined : matchContext)}
                                    </div>
                                </div>
                            </td>
                        </tr>
                    )}
                </>
            )}
            {/* The expand-to-edit panel is gone, so this is the only place errors/
                warnings/import-failures stay readable without a click — a thin
                sub-row (styled like the duplicate-match sub-row above). */}
            {hasIssue && (
                <tr className={!selected ? 'opacity-40' : ''}>
                    <td></td>
                    <td colSpan={4} className="px-3 pb-2">
                        <div className={`text-xs space-y-0.5 rounded-lg px-2.5 py-1.5 border ${(invalid || failure) ? 'bg-rose-50 border-rose-100' : 'bg-amber-50 border-amber-200'}`}>
                            {invalid && <div className="text-rose-600">{built.errors.join(' ')}</div>}
                            {failure && <div className="text-rose-700 font-medium">✗ Falló al importar: {failure} — corregí el campo y reintentá.</div>}
                            {warned && <div className="text-amber-700">{built.warnings.join(' ')} Corregí la fecha/rating arriba, o dejá el registro así (se importa igual).</div>}
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}

/** The record grid: header + scrollable table body of `RowView` rows. Shared by
 *  BOTH the Revisar (confirm) step — all `filtered` rows — and the Duplicados
 *  (dedup) step — only `matchedRows` — so a record renders identically (same
 *  fields, same match sub-row, same "por qué" panel) regardless of which step
 *  it's viewed from. Kept as a top-level component (not a closure defined inside
 *  SpreadsheetImportWizard's render) so its identity is stable across renders —
 *  a fresh function identity every render would remount every `RowView`/`InlineCell`
 *  underneath, dropping in-progress edits. */
function RecordGrid({
    rows, editingCell, onEditCell, matches, rowAction, onAction,
    failureByIndex, onToggle, onChange, expandedMatchRow, matchContexts, onToggleWhy,
    expandedFieldsRow, onToggleFields,
    onRatingAll, onVisibilityAll,
}: {
    rows: Array<{ index: number; eff: MappedRow; built: ReturnType<typeof buildImportBody>; selected: boolean }>;
    editingCell: { index: number; field: string } | null;
    onEditCell: (index: number, field: string | null) => void;
    matches: Record<number, DuplicateMatch | null>;
    rowAction: Record<number, RowAction>;
    onAction: (index: number, a: RowAction) => void;
    failureByIndex: Record<number, string>;
    onToggle: (index: number) => void;
    onChange: (index: number, p: Partial<MappedRow>) => void;
    expandedMatchRow: number | null;
    matchContexts: Record<string, MatchContext | 'loading' | 'error'>;
    onToggleWhy: (index: number, adopterId: string) => void;
    // "Motivo / más campos" expand — same one-row-at-a-time pattern as the match
    // "por qué" expand above (expandedMatchRow/onToggleWhy).
    expandedFieldsRow: number | null;
    onToggleFields: (index: number) => void;
    // Bulk "a todos" header selects — same global effect (applies to every parsed
    // row, not just `rows`) in both steps, matching the pre-existing behavior.
    onRatingAll: (rating: string) => void;
    onVisibilityAll: (isPublic: boolean) => void;
}) {
    return (
        <div className="border border-stone-200 rounded-xl overflow-hidden">
            <div className="max-h-[420px] overflow-y-auto overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wider sticky top-0">
                        <tr>
                            <th className="px-2 py-2"></th>
                            <th className="px-2 py-2 text-right font-normal text-stone-400">#</th>
                            <th className="text-left px-3 py-2">Nombre</th>
                            <th className="text-left px-3 py-2">Contacto</th>
                            <th className="text-left px-3 py-2">
                                {/* Identity grid is 5 columns now (Animal/Especie/Tipo/Rating/Fecha/Motivo
                                    moved into the per-record interaction line below) — both bulk
                                    "a todos" affordances (rating, visibilidad) collapse into this
                                    header since Visibilidad is the only remaining bulk-editable column. */}
                                <div className="flex items-center gap-1">
                                    <span>Visibilidad</span>
                                    <select value="" onChange={e => { if (e.target.value) onVisibilityAll(e.target.value === 'public'); }}
                                        className="normal-case font-normal text-[11px] border border-stone-200 rounded px-1 py-0.5 bg-white text-stone-500" title="Asignar visibilidad a todos los registros">
                                        <option value="">· a todos</option>
                                        <option value="public">Todos públicos</option>
                                        <option value="protected">Todos protegidos</option>
                                    </select>
                                    {/* Bulk "a todos" — controlled value="" so it snaps back after firing. */}
                                    <select value="" onChange={e => { if (e.target.value) onRatingAll(e.target.value === 'clear' ? '' : e.target.value); }}
                                        className="normal-case font-normal text-[11px] border border-stone-200 rounded px-1 py-0.5 bg-white text-stone-500" title="Asignar un rating a todos los registros">
                                        <option value="">★ a todos</option>
                                        {['1', '2', '3', '4', '5'].map(n => <option key={n} value={n}>{n} ★ a todos</option>)}
                                        <option value="clear">Limpiar rating</option>
                                    </select>
                                </div>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(r => {
                            const match = r.index in matches ? matches[r.index] : undefined;
                            return (
                                <RowView key={r.index} r={r}
                                    editingField={editingCell?.index === r.index ? editingCell.field : null}
                                    onEditCell={field => onEditCell(r.index, field)}
                                    match={match}
                                    action={rowAction[r.index] ?? 'create'}
                                    onAction={a => onAction(r.index, a)}
                                    failure={failureByIndex[r.index]}
                                    onToggle={() => onToggle(r.index)}
                                    onChange={patch => onChange(r.index, patch)}
                                    expanded={expandedMatchRow === r.index}
                                    onToggleWhy={match ? () => onToggleWhy(r.index, match.adopterId) : undefined}
                                    matchContext={match ? matchContexts[match.adopterId] : undefined}
                                    fieldsExpanded={expandedFieldsRow === r.index}
                                    onToggleFields={() => onToggleFields(r.index)}
                                />
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

/** One click-to-edit spreadsheet cell. Display mode is a static button (cheap to
 *  render across hundreds of rows); edit mode renders the live control ONLY for
 *  the single active cell (lifted `editingCell` state in the parent guarantees
 *  at most one control exists in the DOM at a time — see SpreadsheetImportWizard). */
function InlineCell({ active, onActivate, onDeactivate, value, onCommit, kind, options, ariaLabel, display, inline }: {
    active: boolean; onActivate: () => void; onDeactivate: () => void;
    value: string; onCommit: (v: string) => void; kind: 'text' | 'select' | 'date';
    options?: Array<{ value: string; label: string }>; ariaLabel: string; display: React.ReactNode;
    // `inline`: auto-width chip for the horizontal interaction line (a flex-wrap
    // row). The default (`block w-full`) fills a table-cell column in the
    // identity grid — but inside a flex row a full-width child forces every
    // sibling onto its own line (the vertical-stacking bug).
    inline?: boolean;
}) {
    const [draft, setDraft] = useState(value);
    // Re-seed the draft whenever this cell becomes the active one (or the
    // underlying value changes while inactive), so stale text never lingers.
    useEffect(() => { if (active) setDraft(value); }, [active, value]);
    // Escape must discard, not commit. Both the Enter and Escape paths exit via
    // blur (rather than calling onDeactivate directly) so the commit logic lives
    // in ONE place regardless of which path triggered it; the skip flag tells
    // that shared blur handler to discard instead of commit.
    const skipCommit = useRef(false);
    const commitOnBlur = () => {
        if (!skipCommit.current && draft !== value) onCommit(draft);
        skipCommit.current = false;
        onDeactivate();
    };

    if (!active) {
        return (
            <button type="button" onClick={onActivate} aria-label={ariaLabel}
                className={`text-left hover:bg-stone-100 rounded px-1 -mx-1 ${inline ? 'inline-block align-bottom w-auto max-w-full' : 'block w-full'}`}>
                {display}
            </button>
        );
    }

    if (kind === 'select') {
        return (
            <select autoFocus aria-label={ariaLabel} value={draft}
                onChange={e => { onCommit(e.target.value); onDeactivate(); }}
                onBlur={onDeactivate}
                className={`border border-stone-200 rounded px-1 py-0.5 text-sm bg-white ${inline ? 'w-auto' : 'w-full'}`}>
                {options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
        );
    }

    return (
        <input autoFocus aria-label={ariaLabel} type={kind === 'date' ? 'date' : 'text'} value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commitOnBlur}
            onKeyDown={e => {
                if (e.key === 'Enter') e.currentTarget.blur();
                else if (e.key === 'Escape') { skipCommit.current = true; e.currentTarget.blur(); }
            }}
            className={`border border-stone-200 rounded px-1 py-0.5 text-sm bg-white ${inline ? 'w-auto max-w-[150px]' : 'w-full'}`} />
    );
}
