'use client';

/**
 * PendingDedup — top-of-page section on /my-adopters that surfaces auto-
 * created duplicate-candidate pairs for the current rescuer to triage.
 *
 * Replaces the previous "Unlinked Forms" section (v2.14.10-20). After Phase 1,
 * every form submission auto-creates an adopter row, so the old purgatory of
 * "form submitted but no profile yet" is gone. The pending-dedup feed shows
 * pairs where a freshly-created row looks like an existing one, with merge
 * and dismiss actions wired to the existing duplicates pipeline.
 *
 * All Tailwind classes verified themed in globals.css per memory
 * feedback_themed_colors_only.
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { extractErrorId } from '@/lib/errorUtils';
import {
    getPendingDuplicatesForUser,
    dismissDuplicateCandidate,
    mergeAdopters,
    type PendingDedupPair,
} from '@/app/actions/duplicates';

function SourceBadge({ source, t }: { source: string; t: (k: string) => string }) {
    if (source === 'form') return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-700 font-semibold">📝 {t('myAdopters.source_form') || 'Form'}</span>;
    if (source === 'contract') return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-800 font-semibold">✍️ {t('myAdopters.source_contract') || 'Contract'}</span>;
    if (source === 'imported') return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-600 font-semibold">📥 {t('myAdopters.source_imported') || 'Imported'}</span>;
    return null;
}

function AdopterCard({
    side,
    adopter,
    t,
}: {
    side: 'new' | 'existing';
    adopter: PendingDedupPair['newAdopter'];
    t: (k: string) => string;
}) {
    const sideLabel = side === 'new'
        ? t('myAdopters.pending_dedup_side_new') || 'Nuevo (de formulario / contrato)'
        : t('myAdopters.pending_dedup_side_existing') || 'Existente';
    const dateStr = adopter.createdAt
        ? new Date(adopter.createdAt * 1000).toLocaleDateString()
        : null;

    return (
        <div className="flex-1 min-w-0 rounded-xl border border-stone-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-stone-500">{sideLabel}</span>
                <SourceBadge source={adopter.source} t={t} />
            </div>
            <Link href={`/adopter/${adopter.id}`} className="block font-semibold text-stone-900 text-sm truncate hover:text-teal-700" title={adopter.name}>
                {adopter.name}
            </Link>
            {adopter.contactInfo && (
                <p className="mt-1 text-xs text-stone-500 line-clamp-2 whitespace-pre-line">{adopter.contactInfo}</p>
            )}
            {dateStr && <p className="mt-1 text-[11px] text-stone-400">{dateStr}</p>}
        </div>
    );
}

export default function PendingDedup() {
    const { t } = useLanguage();
    const toast = useShowToast();
    const [pairs, setPairs] = useState<PendingDedupPair[] | null>(null);
    const [busyCandidateId, setBusyCandidateId] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const data = await getPendingDuplicatesForUser();
            setPairs(data);
        } catch (e) {
            toast.error(t('errors.generic') || 'Error', undefined, extractErrorId(e));
            setPairs([]);
        }
    }, [t, toast]);

    useEffect(() => { load(); }, [load]);

    const handleMerge = async (pair: PendingDedupPair) => {
        if (busyCandidateId) return;
        setBusyCandidateId(pair.candidateId);
        try {
            const session = await fetch('/api/auth/session').then(r => r.json()).catch(() => null) as { user?: { email?: string } } | null;
            const actor = session?.user?.email || 'unknown';
            // Merge with the EXISTING (older) record as primary so the older
            // profile keeps its id (URLs, references stay valid). New one is
            // soft-deleted and its contactInfo appended.
            const result = await mergeAdopters(pair.existingAdopter.id, pair.newAdopter.id, actor);
            if (result.success) {
                toast.success(t('myAdopters.pending_dedup_merged') || 'Profiles merged');
                setPairs(prev => prev?.filter(p => p.candidateId !== pair.candidateId) || []);
            } else {
                toast.error(t('errors.generic') || 'Error', result.error || 'Merge failed');
            }
        } catch (e) {
            toast.error(t('errors.generic') || 'Error', undefined, extractErrorId(e));
        } finally {
            setBusyCandidateId(null);
        }
    };

    const handleDismiss = async (pair: PendingDedupPair) => {
        if (busyCandidateId) return;
        setBusyCandidateId(pair.candidateId);
        try {
            const result = await dismissDuplicateCandidate(pair.candidateId);
            if (result.success) {
                setPairs(prev => prev?.filter(p => p.candidateId !== pair.candidateId) || []);
            } else {
                toast.error(t('errors.generic') || 'Error', result.error || 'Dismiss failed');
            }
        } catch (e) {
            toast.error(t('errors.generic') || 'Error', undefined, extractErrorId(e));
        } finally {
            setBusyCandidateId(null);
        }
    };

    if (pairs === null) return null; // not loaded yet
    if (pairs.length === 0) return null;

    return (
        <section className="mb-8">
            <h2 className="text-lg font-semibold text-stone-800 mb-1 flex items-center gap-2">
                {t('myAdopters.pending_dedup_title') || 'Pendientes de revisar'}
                <span className="text-sm font-normal text-stone-500 bg-amber-50 px-2 py-0.5 rounded-full">{pairs.length}</span>
            </h2>
            <p className="text-sm text-stone-500 mb-3">
                {t('myAdopters.pending_dedup_subtitle') || 'Encontramos perfiles que podrían ser la misma persona. Decidí si combinarlos.'}
            </p>
            <div className="space-y-3">
                {pairs.map(pair => {
                    const busy = busyCandidateId === pair.candidateId;
                    return (
                        <div key={pair.candidateId} className="bg-white rounded-2xl border border-stone-200 shadow-sm p-4">
                            <div className="flex items-center gap-2 mb-3 text-xs text-stone-500">
                                <span className="font-semibold uppercase tracking-wider">
                                    {pair.confidence === 'high' ? '🔴' : pair.confidence === 'medium' ? '🟡' : '⚪'} {pair.confidence}
                                </span>
                                <span>·</span>
                                <span>{pair.confidencePercent}% {t('myAdopters.pending_dedup_match') || 'coincidencia'}</span>
                                {pair.matchTypes.length > 0 && (
                                    <>
                                        <span>·</span>
                                        <span className="truncate">{pair.matchTypes.join(', ')}</span>
                                    </>
                                )}
                            </div>
                            <div className="flex flex-col md:flex-row gap-3">
                                <AdopterCard side="new" adopter={pair.newAdopter} t={t} />
                                <div className="flex md:flex-col items-center justify-center text-stone-400 text-xs">↔</div>
                                <AdopterCard side="existing" adopter={pair.existingAdopter} t={t} />
                            </div>
                            <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => handleDismiss(pair)}
                                    disabled={busy}
                                    className="px-3 py-2 text-[12px] font-semibold text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-xl transition-colors disabled:opacity-50"
                                >
                                    {t('myAdopters.pending_dedup_action_keep') || 'Mantener separados'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleMerge(pair)}
                                    disabled={busy}
                                    className="px-3 py-2 text-[12px] font-semibold text-white bg-teal-700 hover:bg-teal-600 rounded-xl transition-colors disabled:opacity-50"
                                >
                                    {busy ? (t('common.processing') || 'Processing...') : (t('myAdopters.pending_dedup_action_merge') || 'Combinar perfiles')}
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
