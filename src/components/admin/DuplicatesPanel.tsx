'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import DuplicateMergeModal from '@/components/DuplicateMergeModal';
import { useLanguage } from '@/context/LanguageContext';

/**
 * Duplicate-detection review panel. Moved from the standalone `/admin/duplicates`
 * page into the "Duplicados" tab of the Calidad de datos report (v2.44.2): the
 * fuzzy candidate queue (name similarity + shared contact) plus user-flagged
 * pairs, with merge / dismiss / scan. Backed by /api/admin/duplicates*.
 */

interface DuplicateCandidate {
    id: string;
    adopter1Id: string;
    adopter2Id: string;
    matchTypes: string;
    matchValues: string | null;
    score: number;
    confidence: string;
    status: string;
    source: 'system';
    /** null = profile row missing (or fetch failed, logged server-side);
     *  '' = legitimate nameless profile. Render via AdopterNameLabel. */
    adopter1Name: string | null;
    adopter1Contact?: string | null;
    adopter1AvgRating?: number | null;
    adopter2Name: string | null;
    adopter2Contact?: string | null;
    adopter2AvgRating?: number | null;
}

interface UserFlagged {
    flagId: string;
    adopterId: string;
    targetAdopterId: string | null;
    flaggedBy: string | null;
    details: string | null;
    createdAt: Date | null;
    source: 'user';
    adopter1Name: string | null;
    adopter1Contact?: string | null;
    adopter1AvgRating?: number | null;
    adopter2Name: string | null;
    adopter2Contact?: string | null;
    adopter2AvgRating?: number | null;
}

interface Counts {
    pending: number;
    dismissed: number;
    merged: number;
    userFlagged: number;
}

/** Pairs per page — must match the API route's `limit`. */
const PAGE_SIZE = 50;
/** The merge/unmerge endpoints cap each request at 10 (Workers subrequest
 *  budget); bigger selections are sent as sequential batches of this size. */
const MERGE_CHUNK = 10;
/** Most profiles one mass-merge selection may absorb (5 request batches). */
const MASS_MERGE_SELECTION_MAX = 50;

/** One profile inside a connected duplicate cluster. */
interface ClusterRecord {
    id: string;
    name: string | null;
    contact?: string | null;
    avgRating?: number | null;
}

/**
 * Adopter-name renderer for the dedup screens. Distinguishes the two states
 * the API encodes (see route.ts): null = profile missing → "Eliminado";
 * empty = legitimate NAMELESS profile → the app-wide `adopter.nameless`
 * label (never "Deleted" — that mislabeled 44 real prod profiles).
 */
function AdopterNameLabel({ name }: { name: string | null }) {
    const { t } = useLanguage();
    if (name === null) return <span className="italic text-stone-400">Eliminado</span>;
    if (!name.trim()) return <span className="italic text-stone-500">{t('adopter.nameless')}</span>;
    return <>{name}</>;
}

/** The two records of a pair, shaped for the mass-merge modal. */
function pairRecords(c: DuplicateCandidate): ClusterRecord[] {
    return [
        { id: c.adopter1Id, name: c.adopter1Name, contact: c.adopter1Contact, avgRating: c.adopter1AvgRating },
        { id: c.adopter2Id, name: c.adopter2Name, contact: c.adopter2Contact, avgRating: c.adopter2AvgRating },
    ];
}

/**
 * Union of the records behind the ticked pairs, deduped by adopter id. Reads
 * from the tick-time cache so pairs selected on other pages still count; the
 * current page's rows refresh their cached info on render.
 */
function collectRecords(
    candidates: DuplicateCandidate[],
    selected: Set<string>,
    cacheRef: { current: Map<string, ClusterRecord[]> },
): ClusterRecord[] {
    const byId = new Map<string, ClusterRecord>();
    for (const candidateId of selected) {
        const records = cacheRef.current.get(candidateId)
            ?? candidates.filter(c => c.id === candidateId).flatMap(pairRecords);
        for (const rec of records) {
            if (!byId.has(rec.id)) byId.set(rec.id, rec);
        }
    }
    return [...byId.values()];
}

export default function DuplicatesPanel() {
    const { t } = useLanguage();
    const [userFlagged, setUserFlagged] = useState<UserFlagged[]>([]);
    const [candidates, setCandidates] = useState<DuplicateCandidate[]>([]);
    const [counts, setCounts] = useState<Counts>({ pending: 0, dismissed: 0, merged: 0, userFlagged: 0 });
    const [loading, setLoading] = useState(true);
    const [scanning, setScanning] = useState(false);
    const [scanResult, setScanResult] = useState<string | null>(null);
    // -1 = unknown (the server could not compute it), not zero.
    const [staleCount, setStaleCount] = useState<number>(-1);
    // Completion state of the LAST scan. `lastRun` only advances when a scan
    // reaches its completion block, so it is the one trustworthy signal that a
    // run finished — candidates appearing is not.
    const [scan, setScan] = useState<{ status: string | null; lastRun: string | null }>({ status: null, lastRun: null });
    const [mergeTarget, setMergeTarget] = useState<{ a1: any; a2: any; matchTypes: string[]; candidateId?: string; flagId?: string } | null>(null);
    const [statusFilter, setStatusFilter] = useState<'pending' | 'dismissed' | 'merged'>('pending');
    const [page, setPage] = useState(1);
    // Total candidates under the current status+confidence filter — drives the
    // pager. counts.pending can't stand in: it ignores the confidence filter.
    const [filteredTotal, setFilteredTotal] = useState(0);
    // Low-confidence pairs are ~75% of the queue and mostly two people who
    // share one name word — hidden by default so real signal isn't drowned.
    const [showLow, setShowLow] = useState(false);
    const [massMergeCluster, setMassMergeCluster] = useState<ClusterRecord[] | null>(null);
    // Ticked pending pair cards (candidate ids) + a cache of their records so
    // the selection survives paging away from where a pair was ticked.
    const [selectedPairs, setSelectedPairs] = useState<Set<string>>(new Set());
    const selectedRecordCache = useRef(new Map<string, ClusterRecord[]>());
    // The last merge action's audit ids (one per absorbed profile), newest
    // last — the handle for undo — plus the survivor ids for the "open
    // profile" link. Cleared by the next merge, an undo, or dismissing the
    // toast; surviving a refetch is intentional.
    const [lastMerge, setLastMerge] = useState<{ auditIds: string[]; label: string; primaryIds: string[] } | null>(null);
    const [undoing, setUndoing] = useState(false);
    // The success toast auto-hides after 15s, but lastMerge (and with it the
    // Deshacer affordance) outlives it as a compact header chip — the undo
    // safety net must not expire with a toast.
    const [toastVisible, setToastVisible] = useState(false);
    useEffect(() => {
        if (!lastMerge) { setToastVisible(false); return; }
        setToastVisible(true);
        const t = setTimeout(() => setToastVisible(false), 15000);
        return () => clearTimeout(t);
    }, [lastMerge]);
    // Batch pair-merge progress ('' = not running); disables the bar while set.
    const [bulkProgress, setBulkProgress] = useState('');

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const conf = showLow ? '' : '&confidence=high,medium';
            const res = await fetch(`/api/admin/duplicates?status=${statusFilter}&page=${page}${conf}`);
            if (!res.ok) throw new Error('Failed to fetch');
            const data = await res.json() as { userFlagged?: UserFlagged[]; candidates?: DuplicateCandidate[]; counts?: Counts; filteredTotal?: number; staleCount?: number; scan?: { status: string | null; lastRun: string | null } };
            setUserFlagged(data.userFlagged || []);
            setCandidates(data.candidates || []);
            setCounts(data.counts || { pending: 0, dismissed: 0, merged: 0, userFlagged: 0 });
            setFilteredTotal(data.filteredTotal ?? (data.candidates?.length || 0));
            setStaleCount(typeof data.staleCount === 'number' ? data.staleCount : -1);
            setScan(data.scan ?? { status: null, lastRun: null });
        } catch (error) {
            console.error('Failed to load duplicates:', error);
        } finally {
            setLoading(false);
        }
    }, [statusFilter, page, showLow]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const totalPages = Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE));
    // Merges/dismissals shrink the list under us; clamp rather than show an empty page.
    useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

    // Mass-merge selection: tick pending pair cards, then merge the union of
    // their records in one pass. Keyed by candidate id; survives paging so a
    // cluster split across pages can still be gathered into one merge.
    const selectedRecords = collectRecords(candidates, selectedPairs, selectedRecordCache);
    useEffect(() => {
        // Cache the record info of every selected pair so a selection made on
        // page 1 still renders in the bar/modal after paging to page 3.
        for (const c of candidates) {
            if (selectedPairs.has(c.id)) {
                selectedRecordCache.current.set(c.id, pairRecords(c));
            }
        }
    });

    function togglePair(c: DuplicateCandidate) {
        setSelectedPairs(prev => {
            const next = new Set(prev);
            if (next.has(c.id)) {
                next.delete(c.id);
                selectedRecordCache.current.delete(c.id);
            } else {
                next.add(c.id);
                selectedRecordCache.current.set(c.id, pairRecords(c));
            }
            return next;
        });
    }

    function clearSelection() {
        setSelectedPairs(new Set());
        selectedRecordCache.current.clear();
    }

    const allVisibleSelected = candidates.length > 0 && candidates.every(c => selectedPairs.has(c.id));

    function toggleAllVisible() {
        setSelectedPairs(prev => {
            const next = new Set(prev);
            if (allVisibleSelected) {
                for (const c of candidates) {
                    next.delete(c.id);
                    selectedRecordCache.current.delete(c.id);
                }
            } else {
                for (const c of candidates) {
                    next.add(c.id);
                    selectedRecordCache.current.set(c.id, pairRecords(c));
                }
            }
            return next;
        });
    }

    /**
     * The queue-clearing action: merge EACH selected pair independently — the
     * server auto-picks each pair's survivor (more activity → more contact
     * data → older). Chunked requests; pairs invalidated by an earlier merge
     * in the batch come back as skips, which is expected, not an error.
     */
    async function handleMergePairs() {
        const candidateIds = [...selectedPairs];
        if (candidateIds.length === 0 || bulkProgress) return;
        let merged = 0;
        let skipped = 0;
        const failures: string[] = [];
        const auditIds: string[] = [];
        const survivorIds = new Set<string>();
        try {
            for (let i = 0; i < candidateIds.length; i += MERGE_CHUNK) {
                setBulkProgress(`Fusionando… ${merged + skipped}/${candidateIds.length}`);
                const batch = candidateIds.slice(i, i + MERGE_CHUNK);
                const res = await fetch('/api/admin/duplicates/merge', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ candidateIds: batch }),
                });
                const data = await res.json() as { error?: string; results?: Array<{ candidateId: string; success: boolean; skipped?: boolean; error?: string; auditId?: string; primaryId?: string }> };
                if (!res.ok) {
                    failures.push(data.error ?? `HTTP ${res.status}`);
                    break;
                }
                for (const r of data.results || []) {
                    if (!r.success) failures.push(r.error ?? 'unknown');
                    else if (r.skipped) skipped++;
                    else {
                        merged++;
                        if (r.auditId) auditIds.push(r.auditId);
                        if (r.primaryId) survivorIds.add(r.primaryId);
                    }
                }
            }
        } finally {
            setBulkProgress('');
        }
        if (failures.length > 0) {
            alert(`Se fusionaron ${merged} pares, pero hubo fallas:\n${failures.map(f => `• ${f}`).join('\n')}`);
        }
        setLastMerge(auditIds.length > 0 ? { auditIds, label: `${merged} par${merged === 1 ? '' : 'es'} fusionado${merged === 1 ? '' : 's'}${skipped ? ` (${skipped} ya resueltos)` : ''}`, primaryIds: [...survivorIds] } : null);
        clearSelection();
        fetchData();
    }

    /**
     * The scan re-tokenizes in batches (the endpoint caps each call so a Worker
     * can't blow its subrequest ceiling), so one click loops until `done`.
     *
     * This matters on a TOKENIZER_VERSION bump, which marks every record stale
     * at once — 1,146 in production as of v2.49, i.e. ~12 batches. Doing that by
     * hand means clicking until the counter stops moving, with no way to tell
     * "finished" from "silently stopped early".
     *
     * `maxBatches` is a safety stop: if `remaining` ever fails to decrease, the
     * loop would otherwise spin forever against the same records.
     */
    async function handleScan() {
        setScanning(true);
        setScanResult(null);
        const maxBatches = 100;
        let totalTokenized = 0;
        let lastRemaining = Infinity;

        try {
            for (let batch = 0; batch < maxBatches; batch++) {
                const res = await fetch('/api/admin/duplicates', { method: 'POST' });

                // Read as text first. A Worker killed mid-request (subrequest
                // ceiling, CPU limit) returns an HTML/plain error page, and
                // calling res.json() on that throws — which used to land in the
                // catch below as a bare "Scan failed", hiding both the status
                // code and the fact that the run had died rather than errored.
                const raw = await res.text();
                let data: {
                    done?: boolean; tokenized?: number; remaining?: number;
                    staleBefore?: number; newCandidates?: number; error?: string;
                } = {};
                try { data = JSON.parse(raw); } catch {
                    setScanResult(
                        `❌ HTTP ${res.status} — the scan worker died mid-batch` +
                        `${totalTokenized ? ` after ${totalTokenized} profiles` : ''}. ` +
                        `Try a smaller batch. Response: ${raw.slice(0, 120)}`
                    );
                    return;
                }

                if (!res.ok) {
                    setScanResult(`❌ HTTP ${res.status}: ${data.error ?? 'unknown error'}${totalTokenized ? ` (${totalTokenized} tokenized before the failure)` : ''}`);
                    return;
                }

                totalTokenized += data.tokenized ?? 0;
                const remaining = data.remaining ?? 0;

                if (data.done) {
                    setScanResult(`✅ Scan complete: ${totalTokenized} profiles tokenized, ${data.newCandidates} new candidates found`);
                    fetchData();
                    return;
                }

                // No forward progress — stop rather than hammer the endpoint.
                if (remaining >= lastRemaining) {
                    setScanResult(`⚠️ Scan stalled with ${remaining} profiles left (${totalTokenized} done). Try again.`);
                    return;
                }
                lastRemaining = remaining;
                setScanResult(`⏳ Re-tokenizing… ${totalTokenized} done, ${remaining} to go`);
            }
            setScanResult(`⚠️ Stopped after ${maxBatches} batches (${totalTokenized} tokenized). Run Scan again to continue.`);
        } catch {
            setScanResult(`❌ Scan failed${totalTokenized ? ` after ${totalTokenized} profiles` : ''}`);
        } finally {
            setScanning(false);
        }
    }

    async function handleDismiss(candidateId?: string, flagId?: string) {
        if (!confirm(t('dialogs.confirm_dismiss_duplicate'))) return;
        try {
            const res = await fetch('/api/admin/duplicates/dismiss', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ candidateId, flagId }),
            });
            if (res.ok) {
                fetchData();
            }
        } catch (error) {
            console.error('Dismiss failed:', error);
        }
    }

    async function handleMerge(primaryId: string, secondaryId: string) {
        const res = await fetch('/api/admin/duplicates/merge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ primaryId, secondaryId }),
        });
        const data = await res.json() as { error?: string; results?: Array<{ success: boolean; auditId?: string }> };
        if (res.ok) {
            const auditIds = (data.results || []).filter(r => r.success && r.auditId).map(r => r.auditId!);
            setLastMerge(auditIds.length > 0 ? { auditIds, label: '1 perfil fusionado', primaryIds: [primaryId] } : null);
            setMergeTarget(null);
            clearSelection();
            fetchData();
        } else {
            alert(`Merge failed: ${data.error}`);
        }
    }

    async function handleMassMerge(primaryId: string, secondaryIds: string[]) {
        // The endpoint caps each request at MERGE_CHUNK secondaries; bigger
        // selections go as sequential batches (server-side merges are already
        // sequential per request, so this is the same semantics, just spread
        // over several Workers invocations). Stop at the first transport-level
        // failure — later batches would merge into a survivor whose state we
        // no longer trust.
        const allResults: Array<{ secondaryId: string; success: boolean; error?: string; auditId?: string }> = [];
        let transportError: string | null = null;
        for (let i = 0; i < secondaryIds.length; i += MERGE_CHUNK) {
            const batch = secondaryIds.slice(i, i + MERGE_CHUNK);
            const res = await fetch('/api/admin/duplicates/merge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ primaryId, secondaryIds: batch }),
            });
            const data = await res.json() as { error?: string; results?: Array<{ secondaryId: string; success: boolean; error?: string; auditId?: string }> };
            if (!res.ok) {
                transportError = data.error ?? `HTTP ${res.status}`;
                if (data.results) allResults.push(...data.results);
                break;
            }
            allResults.push(...(data.results || []));
        }

        const okResults = allResults.filter(r => r.success);
        const failed = allResults.filter(r => !r.success);
        if (transportError && okResults.length === 0) {
            alert(`Merge failed: ${transportError}`);
            return;
        }
        if (failed.length > 0 || transportError) {
            alert(`Se fusionaron ${okResults.length} perfiles, pero ${failed.length || 'algunos'} fallaron:\n${failed.map(f => `• ${f.error}`).join('\n')}${transportError ? `\n• ${transportError}` : ''}`);
        }
        const auditIds = okResults.filter(r => r.auditId).map(r => r.auditId!);
        setLastMerge(auditIds.length > 0 ? { auditIds, label: `${auditIds.length} perfil${auditIds.length === 1 ? '' : 'es'} fusionado${auditIds.length === 1 ? '' : 's'}`, primaryIds: [primaryId] } : null);
        setMassMergeCluster(null);
        clearSelection();
        fetchData();
    }

    async function handleUndo() {
        if (!lastMerge || undoing) return;
        setUndoing(true);
        try {
            // Newest-first: a later merge into the same survivor must be
            // reversed before an earlier one (the server enforces this too).
            // Chunked like the merge — the endpoint takes at most MERGE_CHUNK
            // per request; batch order preserves the newest-first invariant.
            const reversed = [...lastMerge.auditIds].reverse();
            let undone = 0;
            const failures: string[] = [];
            for (let i = 0; i < reversed.length; i += MERGE_CHUNK) {
                const batch = reversed.slice(i, i + MERGE_CHUNK);
                const res = await fetch('/api/admin/duplicates/unmerge', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ auditIds: batch }),
                });
                const data = await res.json() as { undoneCount?: number; error?: string; results?: Array<{ success: boolean; error?: string }> };
                if (!res.ok) {
                    failures.push(data.error ?? `HTTP ${res.status}`);
                    break;
                }
                undone += data.undoneCount ?? 0;
                failures.push(...(data.results || []).filter(r => !r.success).map(r => r.error ?? 'unknown'));
            }
            if (failures.length > 0) {
                alert(`Se deshicieron ${undone} fusiones, pero hubo fallas:\n${failures.map(f => `• ${f}`).join('\n')}`);
            }
            if (undone > 0 || failures.length === 0) {
                setLastMerge(null);
                clearSelection();
                fetchData();
            }
        } finally {
            setUndoing(false);
        }
    }

    function openMergeModal(item: UserFlagged | DuplicateCandidate) {
        if (item.source === 'user') {
            const flag = item as UserFlagged;
            if (!flag.targetAdopterId) {
                alert('This flag has no target adopter specified.');
                return;
            }
            setMergeTarget({
                a1: { id: flag.adopterId, name: flag.adopter1Name ?? '', contact: flag.adopter1Contact, avgRating: flag.adopter1AvgRating },
                a2: { id: flag.targetAdopterId, name: flag.adopter2Name ?? '', contact: flag.adopter2Contact, avgRating: flag.adopter2AvgRating },
                matchTypes: ['user_flagged'],
                flagId: flag.flagId,
            });
        } else {
            const c = item as DuplicateCandidate;
            const types = JSON.parse(c.matchTypes || '[]');
            setMergeTarget({
                a1: { id: c.adopter1Id, name: c.adopter1Name ?? '', contact: c.adopter1Contact, avgRating: c.adopter1AvgRating },
                a2: { id: c.adopter2Id, name: c.adopter2Name ?? '', contact: c.adopter2Contact, avgRating: c.adopter2AvgRating },
                matchTypes: types,
                candidateId: c.id,
            });
        }
    }

    return (
        <div className="space-y-6">
            {/* Compact header — the "Duplicados" tab label is the heading; keep only the Scan action. */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-sm text-stone-500">
                    <p>Candidatos por similitud de nombre + contacto compartido, más los reportados por usuarios.</p>
                    {/* Pending re-tokenization. Only meaningful signal for "is the
                        scan finished?" — see the staleCount comment in the API. */}
                    {!loading && staleCount > 0 && (
                        <p className="mt-1 font-medium text-amber-700">
                            {staleCount} perfil{staleCount === 1 ? '' : 'es'} pendiente{staleCount === 1 ? '' : 's'} de re-tokenizar
                        </p>
                    )}
                    {!loading && staleCount === 0 && (
                        <p className="mt-1 font-medium text-teal-700">Todos los perfiles están tokenizados</p>
                    )}
                    {/* Completion state of the LAST scan.
                        Load-bearing: `staleCount === 0` only means TOKENIZING
                        finished. A scan that tokenized everything and then died
                        during pair detection leaves the line above reading
                        "todos tokenizados" while the candidate rebuild failed —
                        which is exactly how a dead scan passed for a successful
                        one. `lastRun` advances only in the completion block, so
                        it is the one signal that the whole run finished. */}
                    {!loading && (
                        <p className={`mt-1 ${scan.status === 'idle' ? 'text-stone-500' : 'font-medium text-amber-700'}`}>
                            {scan.lastRun
                                ? `Última exploración completa: ${new Date(scan.lastRun).toLocaleString('es-AR')}`
                                : 'Nunca se completó una exploración'}
                            {scan.status && scan.status !== 'idle' && (
                                <> · la última no terminó (estado: {scan.status})</>
                            )}
                        </p>
                    )}
                </div>
                <button
                    onClick={handleScan}
                    disabled={scanning}
                    className="px-5 py-2.5 text-sm font-semibold text-white bg-teal-600 rounded-xl hover:bg-teal-700 disabled:opacity-50 transition-colors"
                >
                    {scanning ? '⏳ Scanning...' : '🔄 Scan Now'}
                </button>
            </div>

            {/* Post-merge success toast (auto-hides after 15s) — carries the
                link to the surviving profile and the Deshacer safety net that
                replaced the per-merge confirm() dialog. After the toast hides,
                undo stays reachable via the compact header chip below. */}
            {lastMerge && toastVisible && (
                <div className="text-sm px-4 py-3 rounded-xl bg-teal-50 text-teal-800 border border-teal-200 flex items-center justify-between gap-3 flex-wrap">
                    <span className="flex items-center gap-3 flex-wrap">
                        ✅ {lastMerge.label}.
                        {lastMerge.primaryIds.length === 1 && (
                            <a
                                href={`/adopter/${lastMerge.primaryIds[0]}`}
                                target="_blank"
                                className="font-semibold underline hover:text-teal-900"
                            >
                                Abrir el perfil resultante →
                            </a>
                        )}
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleUndo}
                            disabled={undoing}
                            className="px-3 py-1.5 text-xs font-semibold text-teal-800 bg-white border border-teal-300 rounded-lg hover:bg-teal-100 disabled:opacity-50"
                        >
                            {undoing ? 'Deshaciendo…' : '↩︎ Deshacer'}
                        </button>
                        <button
                            onClick={() => setLastMerge(null)}
                            className="px-2 py-1.5 text-xs font-medium text-teal-700 hover:text-teal-900"
                            aria-label="Cerrar"
                        >
                            ✕
                        </button>
                    </div>
                </div>
            )}
            {/* Undo outlives the toast: compact chip until the next action. */}
            {lastMerge && !toastVisible && (
                <div className="flex justify-end">
                    <button
                        onClick={handleUndo}
                        disabled={undoing}
                        className="px-3 py-1.5 text-xs font-medium text-stone-500 bg-stone-100 rounded-lg hover:bg-stone-200 hover:text-stone-700 disabled:opacity-50"
                        title={lastMerge.label}
                    >
                        {undoing ? 'Deshaciendo…' : '↩︎ Deshacer última fusión'}
                    </button>
                </div>
            )}

            {/* Scan result */}
            {scanResult && (
                <div className={`text-sm px-4 py-3 rounded-xl ${scanResult.startsWith('✅')
                    ? 'bg-green-50 text-green-700 border border-green-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
                    }`}>
                    {scanResult}
                </div>
            )}

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Pending" value={counts.pending} color="amber" active={statusFilter === 'pending'} onClick={() => { setStatusFilter('pending'); setPage(1); }} />
                <StatCard label="User Flagged" value={counts.userFlagged} color="rose" />
                <StatCard label="Dismissed" value={counts.dismissed} color="stone" active={statusFilter === 'dismissed'} onClick={() => { setStatusFilter('dismissed'); setPage(1); }} />
                <StatCard label="Merged" value={counts.merged} color="teal" active={statusFilter === 'merged'} onClick={() => { setStatusFilter('merged'); setPage(1); }} />
            </div>

            {loading ? (
                <div className="text-center py-12 text-stone-500">Loading...</div>
            ) : (
                <>
                    {/* Section 1: User-Flagged */}
                    {userFlagged.length > 0 && (
                        <section>
                            <h2 className="text-lg font-semibold text-stone-800 mb-3">🚩 User-Reported Duplicates</h2>
                            <div className="space-y-3">
                                {userFlagged.map(flag => (
                                    <CandidateCard
                                        key={flag.flagId}
                                        name1={flag.adopter1Name}
                                        name2={flag.targetAdopterId ? flag.adopter2Name : '(sin perfil destino)'}
                                        contact1={flag.adopter1Contact}
                                        contact2={flag.adopter2Contact}
                                        id1={flag.adopterId}
                                        id2={flag.targetAdopterId}
                                        matchTypes={['user_flagged']}
                                        confidence="user"
                                        score={null}
                                        details={flag.details}
                                        flaggedBy={flag.flaggedBy}
                                        onMerge={() => openMergeModal(flag)}
                                        onDismiss={() => handleDismiss(undefined, flag.flagId)}
                                    />
                                ))}
                            </div>
                        </section>
                    )}

                    {/* Section 2: System-Detected */}
                    <section>
                        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                            <h2 className="text-lg font-semibold text-stone-800">
                                🔍 System-Detected ({statusFilter})
                            </h2>
                            <div className="flex items-center gap-4 flex-wrap">
                                {statusFilter === 'pending' && candidates.length > 0 && (
                                    <label className="flex items-center gap-2 text-sm font-medium text-teal-700 cursor-pointer select-none">
                                        <input
                                            type="checkbox"
                                            checked={allVisibleSelected}
                                            onChange={toggleAllVisible}
                                            className="h-5 w-5 rounded border-stone-300 text-teal-600 focus:ring-teal-500"
                                        />
                                        Seleccionar página ({candidates.length})
                                    </label>
                                )}
                                <label className="flex items-center gap-2 text-sm text-stone-600 cursor-pointer select-none">
                                    <input
                                        type="checkbox"
                                        checked={showLow}
                                        onChange={e => { setShowLow(e.target.checked); setPage(1); }}
                                        className="rounded border-stone-300 text-teal-600 focus:ring-teal-500"
                                    />
                                    Mostrar confianza baja
                                </label>
                            </div>
                        </div>
                        {candidates.length === 0 ? (
                            <div className="text-center py-12 text-stone-500 bg-stone-50 rounded-xl">
                                {statusFilter === 'pending'
                                    ? 'No pending duplicates. Click "Scan Now" to check.'
                                    : `No ${statusFilter} candidates.`
                                }
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {candidates.map(c => {
                                    const types = JSON.parse(c.matchTypes || '[]');
                                    return (
                                        <CandidateCard
                                            key={c.id}
                                            name1={c.adopter1Name}
                                            name2={c.adopter2Name}
                                            contact1={c.adopter1Contact}
                                            contact2={c.adopter2Contact}
                                            id1={c.adopter1Id}
                                            id2={c.adopter2Id}
                                            matchTypes={types}
                                            confidence={c.confidence}
                                            score={c.score}
                                            details={null}
                                            flaggedBy={null}
                                            onMerge={statusFilter === 'pending' ? () => openMergeModal(c) : undefined}
                                            onDismiss={statusFilter === 'pending' ? () => handleDismiss(c.id) : undefined}
                                            selected={selectedPairs.has(c.id)}
                                            onToggleSelect={statusFilter === 'pending' ? () => togglePair(c) : undefined}
                                        />
                                    );
                                })}
                            </div>
                        )}
                        {/* Pager. The API caps each page at 20; without this the
                            panel silently presented "top 20 by score" as the whole
                            queue — 779 pending in prod looked like 20. */}
                        {totalPages > 1 && (
                            <div className="flex items-center justify-center gap-4 mt-4 text-sm">
                                <button
                                    onClick={() => setPage(p => Math.max(1, p - 1))}
                                    disabled={page <= 1}
                                    className="px-3 py-1.5 font-medium text-stone-600 bg-stone-100 rounded-lg hover:bg-stone-200 disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    ← Anterior
                                </button>
                                <span className="text-stone-600">
                                    Página {page} de {totalPages} · {filteredTotal} candidatos
                                </span>
                                <button
                                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                    disabled={page >= totalPages}
                                    className="px-3 py-1.5 font-medium text-stone-600 bg-stone-100 rounded-lg hover:bg-stone-200 disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    Siguiente →
                                </button>
                            </div>
                        )}
                    </section>
                </>
            )}

            {/* Floating mass-merge bar — appears while pending pairs are ticked.
                Fixed to the viewport bottom so it stays reachable however far
                down the list the last checkbox was. */}
            {statusFilter === 'pending' && selectedPairs.size > 0 && (
                <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-stone-900 text-white rounded-2xl shadow-lg px-5 py-3 flex items-center gap-4 flex-wrap justify-center">
                    <span className="text-sm">
                        {selectedPairs.size} par{selectedPairs.size === 1 ? '' : 'es'} seleccionado{selectedPairs.size === 1 ? '' : 's'}
                    </span>
                    {/* Primary: each pair merges independently (queue clearing). */}
                    <button
                        onClick={handleMergePairs}
                        disabled={!!bulkProgress || undoing}
                        className="px-4 py-1.5 text-sm font-semibold bg-teal-500 rounded-lg hover:bg-teal-400 disabled:opacity-50"
                    >
                        {bulkProgress || `Fusionar cada par (${selectedPairs.size})`}
                    </button>
                    {/* Secondary: pool EVERY selected record into ONE survivor —
                        only for a single person's cluster, never for clearing
                        unrelated pairs. */}
                    <button
                        onClick={() => setMassMergeCluster(selectedRecords)}
                        disabled={!!bulkProgress || selectedRecords.length < 2}
                        className="px-3 py-1.5 text-xs font-medium text-stone-300 border border-stone-600 rounded-lg hover:text-white hover:border-stone-400 disabled:opacity-50"
                        title="Solo para varios registros de la MISMA persona"
                    >
                        Unir todo en un perfil…
                    </button>
                    <button
                        onClick={clearSelection}
                        disabled={!!bulkProgress}
                        className="text-sm text-stone-300 hover:text-white disabled:opacity-50"
                    >
                        Limpiar
                    </button>
                </div>
            )}

            {/* Merge Modal */}
            {mergeTarget && (
                <DuplicateMergeModal
                    adopter1={mergeTarget.a1}
                    adopter2={mergeTarget.a2}
                    matchTypes={mergeTarget.matchTypes}
                    onMerge={handleMerge}
                    onClose={() => setMergeTarget(null)}
                />
            )}

            {/* Mass-merge Modal */}
            {massMergeCluster && (
                <MassMergeModal
                    records={massMergeCluster}
                    onMerge={handleMassMerge}
                    onClose={() => setMassMergeCluster(null)}
                />
            )}
        </div>
    );
}

// ── Sub-components ───────────────────────────────────────────────

function StatCard({ label, value, color, active, onClick }: {
    label: string; value: number; color: string; active?: boolean; onClick?: () => void;
}) {
    const colorMap: Record<string, string> = {
        amber: 'bg-amber-50 text-amber-700 border-amber-200',
        rose: 'bg-rose-50 text-rose-700 border-rose-200',
        stone: 'bg-stone-50 text-stone-700 border-stone-200',
        teal: 'bg-teal-50 text-teal-700 border-teal-200',
    };
    return (
        <button
            onClick={onClick}
            className={`p-3 rounded-xl border text-center transition-all ${colorMap[color]} ${active ? 'ring-2 ring-offset-1 ring-teal-500' : ''} ${onClick ? 'cursor-pointer hover:shadow-sm' : 'cursor-default'}`}
        >
            <p className="text-2xl font-semibold">{value}</p>
            <p className="text-xs font-medium">{label}</p>
        </button>
    );
}

/**
 * Mass-merge a connected cluster: pick ONE survivor, tick which of the rest to
 * absorb (all by default). Calls the merge endpoint once with secondaryIds[];
 * the server merges them sequentially into the survivor.
 */
function MassMergeModal({ records, onMerge, onClose }: {
    records: ClusterRecord[];
    onMerge: (primaryId: string, secondaryIds: string[]) => Promise<void>;
    onClose: () => void;
}) {
    const [primaryId, setPrimaryId] = useState<string>(records[0]?.id ?? '');
    const [selected, setSelected] = useState<Set<string>>(new Set(records.map(r => r.id)));
    const [merging, setMerging] = useState(false);

    const primary = records.find(r => r.id === primaryId);
    const secondaryIds = records.filter(r => r.id !== primaryId && selected.has(r.id)).map(r => r.id);

    function toggle(id: string) {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    async function handleConfirm() {
        if (!primary || secondaryIds.length === 0) return;
        // No confirm() dialog: the modal itself is the confirmation, and the
        // merge is undoable from the panel's post-merge banner.
        setMerging(true);
        try {
            await onMerge(primaryId, secondaryIds);
        } finally {
            setMerging(false);
        }
    }

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div
                className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90svh] overflow-y-auto"
                onClick={e => e.stopPropagation()}
            >
                <div className="p-6 border-b border-stone-200">
                    <h3 className="text-xl font-semibold text-stone-900">Fusionar grupo de duplicados</h3>
                    <p className="text-sm text-stone-500 mt-1">Elegí qué perfil conservar; los seleccionados se fusionan dentro de él.</p>
                </div>

                <div className="p-6 space-y-2">
                    {records.map(rec => {
                        const isPrimary = rec.id === primaryId;
                        return (
                            <div
                                key={rec.id}
                                className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all ${isPrimary ? 'border-teal-500 bg-teal-50/50' : 'border-stone-200'}`}
                            >
                                <label className="flex items-center gap-2 flex-shrink-0 cursor-pointer" title="Conservar este perfil">
                                    <input
                                        type="radio"
                                        name="mass-merge-primary"
                                        checked={isPrimary}
                                        onChange={() => setPrimaryId(rec.id)}
                                        className="text-teal-600 focus:ring-teal-500"
                                    />
                                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${isPrimary ? 'bg-teal-100 text-teal-700' : 'bg-stone-100 text-stone-400'}`}>
                                        Conservar
                                    </span>
                                </label>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-stone-900 truncate"><AdopterNameLabel name={rec.name} /></p>
                                    {rec.contact && <p className="text-xs text-stone-500 line-clamp-1">{rec.contact}</p>}
                                </div>
                                {!isPrimary && (
                                    <label className="flex items-center gap-2 flex-shrink-0 cursor-pointer text-xs text-stone-600 select-none">
                                        <input
                                            type="checkbox"
                                            checked={selected.has(rec.id)}
                                            onChange={() => toggle(rec.id)}
                                            className="rounded border-stone-300 text-red-600 focus:ring-red-500"
                                        />
                                        Fusionar
                                    </label>
                                )}
                            </div>
                        );
                    })}

                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm mt-4">
                        <p className="text-amber-700">
                            Se fusionarán <strong>{secondaryIds.length}</strong> perfil{secondaryIds.length === 1 ? '' : 'es'} en <strong><AdopterNameLabel name={primary?.name ?? null} /></strong>. Sus actividades y contactos se mueven al perfil conservado y sus nombres quedan como alias (siguen encontrándose al buscar).
                        </p>
                        {secondaryIds.length > MASS_MERGE_SELECTION_MAX && (
                            <p className="text-red-700 font-medium mt-2">
                                Máximo {MASS_MERGE_SELECTION_MAX} perfiles por fusión — destildá {secondaryIds.length - MASS_MERGE_SELECTION_MAX} o hacelo en tandas.
                            </p>
                        )}
                    </div>
                </div>

                <div className="p-6 border-t border-stone-200 flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-stone-600 bg-stone-100 rounded-lg hover:bg-stone-200"
                    >
                        Cancelar
                    </button>
                    <button
                        type="button"
                        onClick={handleConfirm}
                        disabled={merging || secondaryIds.length === 0 || secondaryIds.length > MASS_MERGE_SELECTION_MAX}
                        className="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
                    >
                        {merging ? 'Fusionando…' : `Fusionar ${secondaryIds.length || ''}`}
                    </button>
                </div>
            </div>
        </div>
    );
}

function CandidateCard({
    name1, name2, contact1, contact2, id1, id2,
    matchTypes, confidence, score, details, flaggedBy,
    onMerge, onDismiss, selected, onToggleSelect,
}: {
    name1: string | null; name2: string | null;
    contact1?: string | null; contact2?: string | null;
    id1: string; id2?: string | null;
    matchTypes: string[]; confidence: string; score: number | null;
    details: string | null; flaggedBy: string | null;
    onMerge?: () => void; onDismiss?: () => void;
    selected?: boolean; onToggleSelect?: () => void;
}) {
    const matchLabels: Record<string, string> = {
        phone: '📞 Phone', email: '✉️ Email', social: '🌐 Social',
        name_full: '📛 Full Name', name_word: '📝 Name Words',
        address_word: '🏠 Address', source_url: '🔗 Source URL',
        user_flagged: '🚩 User Flagged',
    };
    const matchColors: Record<string, string> = {
        phone: 'bg-blue-100 text-blue-700', email: 'bg-purple-100 text-purple-700',
        social: 'bg-cyan-100 text-cyan-700', name_full: 'bg-amber-100 text-amber-700',
        name_word: 'bg-orange-100 text-orange-700', address_word: 'bg-green-100 text-green-700',
        source_url: 'bg-rose-100 text-rose-700', user_flagged: 'bg-red-100 text-red-700',
    };
    const confColors: Record<string, string> = {
        high: 'bg-red-100 text-red-800', medium: 'bg-amber-100 text-amber-800',
        low: 'bg-stone-100 text-stone-600', user: 'bg-rose-100 text-rose-800',
    };

    return (
        <div className={`bg-white border rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow ${selected ? 'border-teal-500 ring-1 ring-teal-500' : 'border-stone-200'}`}>
            <div className="flex items-start justify-between gap-4">
                {/* Select for mass-merge: ticked pairs pool their records into
                    one multi-profile merge via the floating action bar. */}
                {onToggleSelect && (
                    <input
                        type="checkbox"
                        checked={!!selected}
                        onChange={onToggleSelect}
                        aria-label="Seleccionar para fusión múltiple"
                        className="mt-1 h-5 w-5 flex-shrink-0 rounded border-stone-300 text-teal-600 focus:ring-teal-500 cursor-pointer"
                    />
                )}
                {/* Left: profiles */}
                <div className="flex-1 min-w-0">
                    <div className="grid grid-cols-2 gap-3 mb-3">
                        <div>
                            <p className="text-sm font-semibold text-stone-900 truncate"><AdopterNameLabel name={name1} /></p>
                            {contact1 && <p className="text-xs text-stone-500 mt-0.5 line-clamp-2">{contact1}</p>}
                            <a href={`/adopter/${id1}`} target="_blank" className="text-xs text-teal-700 hover:underline mt-1 inline-block">
                                View →
                            </a>
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-stone-900 truncate"><AdopterNameLabel name={name2} /></p>
                            {contact2 && <p className="text-xs text-stone-500 mt-0.5 line-clamp-2">{contact2}</p>}
                            {id2 && (
                                <a href={`/adopter/${id2}`} target="_blank" className="text-xs text-teal-700 hover:underline mt-1 inline-block">
                                    View →
                                </a>
                            )}
                        </div>
                    </div>
                    {/* Match badges */}
                    <div className="flex flex-wrap gap-1.5 items-center">
                        {matchTypes.map(type => (
                            <span key={type} className={`text-xs px-2 py-0.5 rounded-full font-medium ${matchColors[type] || 'bg-stone-100 text-stone-700'}`}>
                                {matchLabels[type] || type}
                            </span>
                        ))}
                        {confidence && (
                            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${confColors[confidence] || confColors.low}`}>
                                {confidence.toUpperCase()}
                                {score !== null && ` (${score})`}
                            </span>
                        )}
                    </div>
                    {details && <p className="text-xs text-stone-500 mt-2 italic">{details}</p>}
                    {flaggedBy && <p className="text-xs text-stone-500 mt-1">Flagged by: {flaggedBy}</p>}
                </div>

                {/* Right: actions */}
                <div className="flex flex-col gap-2 flex-shrink-0">
                    {onMerge && (
                        <button
                            onClick={onMerge}
                            className="px-3 py-1.5 text-xs font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700"
                        >
                            Merge
                        </button>
                    )}
                    {onDismiss && (
                        <button
                            onClick={onDismiss}
                            className="px-3 py-1.5 text-xs font-medium text-stone-600 bg-stone-100 rounded-lg hover:bg-stone-200"
                        >
                            Dismiss
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
