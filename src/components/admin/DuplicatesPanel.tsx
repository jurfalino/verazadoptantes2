'use client';

import { useState, useEffect, useCallback } from 'react';
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
    adopter1Name: string;
    adopter1Contact?: string | null;
    adopter1AvgRating?: number | null;
    adopter2Name: string;
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
    adopter1Name: string;
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

/** One profile inside a connected duplicate cluster. */
interface ClusterRecord {
    id: string;
    name: string;
    contact?: string | null;
    avgRating?: number | null;
}

/**
 * Group pending pairs into connected components (union-find): A↔B plus B↔C
 * means A, B, C are one cluster. Only clusters of 3+ profiles are returned —
 * a 2-profile "cluster" is just a pair, already handled by the pair card.
 * Operates on the current page only; a cluster split across pages shows the
 * members visible here.
 */
function buildClusters(candidates: DuplicateCandidate[]): ClusterRecord[][] {
    const parent = new Map<string, string>();
    const find = (x: string): string => {
        let root = parent.get(x) ?? x;
        while (root !== (parent.get(root) ?? root)) root = parent.get(root) ?? root;
        parent.set(x, root);
        return root;
    };
    const records = new Map<string, ClusterRecord>();

    for (const c of candidates) {
        const [ra, rb] = [find(c.adopter1Id), find(c.adopter2Id)];
        if (ra !== rb) parent.set(ra, rb);
        if (!records.has(c.adopter1Id)) records.set(c.adopter1Id, { id: c.adopter1Id, name: c.adopter1Name, contact: c.adopter1Contact, avgRating: c.adopter1AvgRating });
        if (!records.has(c.adopter2Id)) records.set(c.adopter2Id, { id: c.adopter2Id, name: c.adopter2Name, contact: c.adopter2Contact, avgRating: c.adopter2AvgRating });
    }

    const groups = new Map<string, ClusterRecord[]>();
    for (const rec of records.values()) {
        const root = find(rec.id);
        const list = groups.get(root);
        if (list) list.push(rec);
        else groups.set(root, [rec]);
    }
    return [...groups.values()].filter(g => g.length >= 3);
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
    // The last merge action's audit ids (one per absorbed profile), newest
    // last — the handle for the Deshacer banner. Cleared by the next merge,
    // an undo, or dismissing the banner; surviving a refetch is intentional.
    const [lastMerge, setLastMerge] = useState<{ auditIds: string[]; label: string } | null>(null);
    const [undoing, setUndoing] = useState(false);

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

    const totalPages = Math.max(1, Math.ceil(filteredTotal / 20));
    // Merges/dismissals shrink the list under us; clamp rather than show an empty page.
    useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

    // Connected components among the pairs on this page: A↔B + B↔C means
    // A, B and C are one duplicate cluster, mass-mergeable in one pass.
    const clusters = statusFilter === 'pending' ? buildClusters(candidates) : [];

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
            setLastMerge(auditIds.length > 0 ? { auditIds, label: '1 perfil fusionado' } : null);
            setMergeTarget(null);
            fetchData();
        } else {
            alert(`Merge failed: ${data.error}`);
        }
    }

    async function handleMassMerge(primaryId: string, secondaryIds: string[]) {
        const res = await fetch('/api/admin/duplicates/merge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ primaryId, secondaryIds }),
        });
        const data = await res.json() as { mergedCount?: number; error?: string; results?: Array<{ secondaryId: string; success: boolean; error?: string; auditId?: string }> };
        if (res.ok) {
            const failed = (data.results || []).filter(r => !r.success);
            if (failed.length > 0) {
                alert(`Se fusionaron ${data.mergedCount ?? 0} perfiles, pero ${failed.length} fallaron:\n${failed.map(f => `• ${f.error}`).join('\n')}`);
            }
            const auditIds = (data.results || []).filter(r => r.success && r.auditId).map(r => r.auditId!);
            setLastMerge(auditIds.length > 0 ? { auditIds, label: `${auditIds.length} perfil${auditIds.length === 1 ? '' : 'es'} fusionado${auditIds.length === 1 ? '' : 's'}` } : null);
            setMassMergeCluster(null);
            fetchData();
        } else {
            alert(`Merge failed: ${data.error}`);
        }
    }

    async function handleUndo() {
        if (!lastMerge || undoing) return;
        setUndoing(true);
        try {
            // Newest-first: a later merge into the same survivor must be
            // reversed before an earlier one (the server enforces this too).
            const res = await fetch('/api/admin/duplicates/unmerge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ auditIds: [...lastMerge.auditIds].reverse() }),
            });
            const data = await res.json() as { undoneCount?: number; error?: string; results?: Array<{ success: boolean; error?: string }> };
            if (res.ok) {
                const failed = (data.results || []).filter(r => !r.success);
                if (failed.length > 0) {
                    alert(`Se deshicieron ${data.undoneCount ?? 0} fusiones, pero ${failed.length} fallaron:\n${failed.map(f => `• ${f.error}`).join('\n')}`);
                }
                setLastMerge(null);
                fetchData();
            } else {
                alert(`No se pudo deshacer: ${data.error}`);
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
                a1: { id: flag.adopterId, name: flag.adopter1Name, contact: flag.adopter1Contact, avgRating: flag.adopter1AvgRating },
                a2: { id: flag.targetAdopterId, name: flag.adopter2Name || 'Unknown', contact: flag.adopter2Contact, avgRating: flag.adopter2AvgRating },
                matchTypes: ['user_flagged'],
                flagId: flag.flagId,
            });
        } else {
            const c = item as DuplicateCandidate;
            const types = JSON.parse(c.matchTypes || '[]');
            setMergeTarget({
                a1: { id: c.adopter1Id, name: c.adopter1Name, contact: c.adopter1Contact, avgRating: c.adopter1AvgRating },
                a2: { id: c.adopter2Id, name: c.adopter2Name, contact: c.adopter2Contact, avgRating: c.adopter2AvgRating },
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

            {/* Post-merge undo banner — the safety net that replaced the
                per-merge confirm() dialog. */}
            {lastMerge && (
                <div className="text-sm px-4 py-3 rounded-xl bg-teal-50 text-teal-800 border border-teal-200 flex items-center justify-between gap-3 flex-wrap">
                    <span>✅ {lastMerge.label}.</span>
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
                                        name2={flag.adopter2Name || '(no target)'}
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

                    {/* Section 1.5: connected clusters on this page — 3+ profiles
                        linked by pairwise matches, offered as one mass-merge. */}
                    {clusters.length > 0 && (
                        <section>
                            <h2 className="text-lg font-semibold text-stone-800 mb-3">🔗 Grupos conectados</h2>
                            <div className="space-y-3">
                                {clusters.map(cluster => (
                                    <div key={cluster.map(r => r.id).join('|')} className="bg-teal-50/50 border border-teal-200 rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap">
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold text-stone-900">
                                                {cluster.length} perfiles conectados entre sí
                                            </p>
                                            <p className="text-xs text-stone-600 mt-0.5 line-clamp-2">
                                                {cluster.map(r => r.name).join(' · ')}
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => setMassMergeCluster(cluster)}
                                            className="px-3 py-1.5 text-xs font-semibold text-white bg-teal-600 rounded-lg hover:bg-teal-700 flex-shrink-0"
                                        >
                                            Fusionar grupo…
                                        </button>
                                    </div>
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
                                    <p className="text-sm font-semibold text-stone-900 truncate">{rec.name}</p>
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
                            Se fusionarán <strong>{secondaryIds.length}</strong> perfil{secondaryIds.length === 1 ? '' : 'es'} en <strong>{primary?.name}</strong>. Sus actividades y contactos se mueven al perfil conservado y sus nombres quedan como alias (siguen encontrándose al buscar).
                        </p>
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
                        disabled={merging || secondaryIds.length === 0}
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
    onMerge, onDismiss,
}: {
    name1: string; name2: string;
    contact1?: string | null; contact2?: string | null;
    id1: string; id2?: string | null;
    matchTypes: string[]; confidence: string; score: number | null;
    details: string | null; flaggedBy: string | null;
    onMerge?: () => void; onDismiss?: () => void;
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
        <div className="bg-white border border-stone-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between gap-4">
                {/* Left: profiles */}
                <div className="flex-1 min-w-0">
                    <div className="grid grid-cols-2 gap-3 mb-3">
                        <div>
                            <p className="text-sm font-semibold text-stone-900 truncate">{name1}</p>
                            {contact1 && <p className="text-xs text-stone-500 mt-0.5 line-clamp-2">{contact1}</p>}
                            <a href={`/adopter/${id1}`} target="_blank" className="text-xs text-teal-700 hover:underline mt-1 inline-block">
                                View →
                            </a>
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-stone-900 truncate">{name2}</p>
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
