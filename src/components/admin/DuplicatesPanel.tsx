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

export default function DuplicatesPanel() {
    const { t } = useLanguage();
    const [userFlagged, setUserFlagged] = useState<UserFlagged[]>([]);
    const [candidates, setCandidates] = useState<DuplicateCandidate[]>([]);
    const [counts, setCounts] = useState<Counts>({ pending: 0, dismissed: 0, merged: 0, userFlagged: 0 });
    const [loading, setLoading] = useState(true);
    const [scanning, setScanning] = useState(false);
    const [scanResult, setScanResult] = useState<string | null>(null);
    const [mergeTarget, setMergeTarget] = useState<{ a1: any; a2: any; matchTypes: string[]; candidateId?: string; flagId?: string } | null>(null);
    const [statusFilter, setStatusFilter] = useState<'pending' | 'dismissed' | 'merged'>('pending');

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/admin/duplicates?status=${statusFilter}`);
            if (!res.ok) throw new Error('Failed to fetch');
            const data = await res.json() as { userFlagged?: UserFlagged[]; candidates?: DuplicateCandidate[]; counts?: Counts };
            setUserFlagged(data.userFlagged || []);
            setCandidates(data.candidates || []);
            setCounts(data.counts || { pending: 0, dismissed: 0, merged: 0, userFlagged: 0 });
        } catch (error) {
            console.error('Failed to load duplicates:', error);
        } finally {
            setLoading(false);
        }
    }, [statusFilter]);

    useEffect(() => { fetchData(); }, [fetchData]);

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
                const data = await res.json() as {
                    done?: boolean; tokenized?: number; remaining?: number;
                    staleBefore?: number; newCandidates?: number; error?: string;
                };

                if (!res.ok) {
                    setScanResult(`❌ ${data.error}${totalTokenized ? ` (${totalTokenized} tokenized before the failure)` : ''}`);
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
        if (res.ok) {
            setMergeTarget(null);
            fetchData();
        } else {
            const data = await res.json() as { error?: string };
            alert(`Merge failed: ${data.error}`);
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
                <p className="text-sm text-stone-500">Candidatos por similitud de nombre + contacto compartido, más los reportados por usuarios.</p>
                <button
                    onClick={handleScan}
                    disabled={scanning}
                    className="px-5 py-2.5 text-sm font-semibold text-white bg-teal-600 rounded-xl hover:bg-teal-700 disabled:opacity-50 transition-colors"
                >
                    {scanning ? '⏳ Scanning...' : '🔄 Scan Now'}
                </button>
            </div>

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
                <StatCard label="Pending" value={counts.pending} color="amber" active={statusFilter === 'pending'} onClick={() => setStatusFilter('pending')} />
                <StatCard label="User Flagged" value={counts.userFlagged} color="rose" />
                <StatCard label="Dismissed" value={counts.dismissed} color="stone" active={statusFilter === 'dismissed'} onClick={() => setStatusFilter('dismissed')} />
                <StatCard label="Merged" value={counts.merged} color="teal" active={statusFilter === 'merged'} onClick={() => setStatusFilter('merged')} />
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

                    {/* Section 2: System-Detected */}
                    <section>
                        <h2 className="text-lg font-semibold text-stone-800 mb-3">
                            🔍 System-Detected ({statusFilter})
                        </h2>
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
