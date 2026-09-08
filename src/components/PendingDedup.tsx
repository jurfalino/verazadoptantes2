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
import { useDateFormat } from '@/context/TimezoneContext';
import { useShowToast } from '@/components/ui/Toast';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import {
    getPendingDuplicatesForUser,
    dismissDuplicateCandidate,
    mergeAdopters,
    type PendingDedupPair,
} from '@/app/actions/duplicates';
import { AdopterName } from '@/components/AdopterName';
import RequestPiiAccessModal from '@/components/RequestPiiAccessModal';

/** Opens-in-new-tab affordance. Inline SVG with currentColor per the icon
 *  convention — an emoji would not inherit the link's hover colour. */
function ExternalLinkIcon({ className = 'w-3 h-3' }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor"
            strokeWidth="1.8" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4h4v4M16 4l-7 7M14 12v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3" />
        </svg>
    );
}

/**
 * The evidence row: which fields actually matched, and their values.
 *
 * Was a bare `matchTypes.join(', ')`, so the user read "name_full, name_word" —
 * internal token names, and no indication of WHICH phone or name matched. The
 * values come from `duplicate_candidates.match_values`; the per-save path stores
 * null, so fall back to the labels alone rather than showing nothing.
 */
function MatchedOn({ pair, t }: { pair: PendingDedupPair; t: (k: string) => string }) {
    if (pair.matchTypes.length === 0) return null;

    const LABEL: Record<string, string> = {
        phone: t('duplicates.match_phone') || 'Teléfono',
        phone_suffix: t('duplicates.match_phone_suffix') || 'Teléfono (final)',
        email: t('duplicates.match_email') || 'Email',
        social: t('duplicates.match_social') || 'Red social',
        social_handle: t('duplicates.match_social') || 'Red social',
        name_full: t('duplicates.match_name_full') || 'Nombre completo',
        name_word: t('duplicates.match_name_word') || 'Nombre',
        address_word: t('duplicates.match_address') || 'Dirección',
        source_url: t('duplicates.match_source_url') || 'URL de origen',
        id_number: t('duplicates.match_id_number') || 'Documento',
        flagged_by_user: t('duplicates.match_flagged') || 'Marcado manualmente',
    };

    return (
        <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-stone-500">
                {t('myAdopters.pending_dedup_matched_on') || 'Coincide en'}:
            </span>
            {pair.matchTypes.map(type => {
                const values = pair.matchValues[type] || [];
                const label = LABEL[type] || type;
                return (
                    <span key={type}
                        className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-900 border border-amber-100">
                        <span className="font-semibold">{label}</span>
                        {values.length > 0 && (
                            <span className="font-mono text-amber-800/90 truncate max-w-[14rem]">
                                {values.slice(0, 2).join(', ')}{values.length > 2 ? '…' : ''}
                            </span>
                        )}
                    </span>
                );
            })}
        </div>
    );
}

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
    formatShortDate,
    onRequestAccess,
}: {
    side: 'new' | 'existing';
    adopter: PendingDedupPair['newAdopter'];
    t: (k: string) => string;
    formatShortDate: (input: Date | number | string) => string;
    onRequestAccess: (adopter: PendingDedupPair['newAdopter']) => void;
}) {
    const sideLabel = side === 'new'
        ? t('myAdopters.pending_dedup_side_new') || 'Nuevo (de formulario / contrato)'
        : t('myAdopters.pending_dedup_side_existing') || 'Existente';
    // Explicit zone, like every other date in the app — a bare
    // toLocaleDateString reads the host timezone (see src/lib/dates.ts).
    const dateStr = adopter.createdAt ? formatShortDate(adopter.createdAt) : null;

    return (
        <div className="flex-1 min-w-0 rounded-xl border border-stone-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-stone-500">{sideLabel}</span>
                <SourceBadge source={adopter.source} t={t} />
            </div>
            {/* Opens in a new tab so the comparison you are mid-way through
                stays on screen — losing it to a navigation is the whole reason
                this decision gets abandoned. */}
            <Link
                href={`/adopter/${adopter.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-1.5 min-w-0"
            >
                <AdopterName adopter={adopter} className="font-semibold text-stone-900 text-sm truncate group-hover:text-teal-700" title />
                <ExternalLinkIcon className="w-3 h-3 shrink-0 text-stone-400 group-hover:text-teal-700" />
                <span className="sr-only">{t('common.opens_new_tab') || '(abre en una pestaña nueva)'}</span>
            </Link>
            {adopter.contactInfo && (
                <p className="mt-1 text-xs text-stone-500 line-clamp-2 whitespace-pre-line">{adopter.contactInfo}</p>
            )}
            {/* The matched values are shown above regardless — they are already
                in the viewer's own record. This is about the REST of the
                contact blob, which belongs to whoever added this profile. */}
            {!adopter.canSeeContact && (
                <button
                    type="button"
                    onClick={() => onRequestAccess(adopter)}
                    className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-teal-700 hover:text-teal-800 underline underline-offset-2"
                >
                    🔒 {t('myAdopters.pending_dedup_request_access') || 'Pedir acceso a quien lo cargó'}
                </button>
            )}
            {dateStr && <p className="mt-1 text-[11px] text-stone-400">{dateStr}</p>}
        </div>
    );
}

export default function PendingDedup() {
    const { t } = useLanguage();
    const { formatShortDate } = useDateFormat();
    const toast = useShowToast();
    const [pairs, setPairs] = useState<PendingDedupPair[] | null>(null);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    // Collapsed by default: production carries hundreds of pending pairs, and a
    // wall of them above the actual adopter list buries the page.
    const [open, setOpen] = useState(false);
    const [busyCandidateId, setBusyCandidateId] = useState<string | null>(null);
    // `low` pairs are ~80% of the queue and mostly weak name overlap. Hidden by
    // default, with a count so the user knows they exist and can opt in.
    const [showLow, setShowLow] = useState(false);
    const [lowHidden, setLowHidden] = useState(0);
    const [accessTarget, setAccessTarget] = useState<PendingDedupPair['newAdopter'] | null>(null);

    const PAGE_SIZE = 10;

    const load = useCallback(async () => {
        try {
            const data = await getPendingDuplicatesForUser(page, PAGE_SIZE, showLow);
            setPairs(data.pairs);
            setTotal(data.total);
            setLowHidden(data.lowHidden);
        } catch (e) {
            toast.error(t('errors.generic') || 'Error', t('errors.load_duplicates_failed') || undefined, resolveErrorId(e, 'PendingDedup'));
            setPairs([]);
            setTotal(0);
            setLowHidden(0);
        }
    }, [t, toast, page, showLow]);

    useEffect(() => { load(); }, [load]);

    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

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
                setTotal(n => Math.max(0, n - 1));
            } else {
                toast.error(t('errors.generic') || 'Error', t('errors.merge_failed') || 'No se pudieron combinar los perfiles.');
            }
        } catch (e) {
            toast.error(t('errors.generic') || 'Error', t('errors.merge_failed') || undefined, resolveErrorId(e, 'PendingDedup'));
        } finally {
            setBusyCandidateId(null);
        }
    };

    const handleDismiss = async (pair: PendingDedupPair) => {
        if (busyCandidateId) return;
        setBusyCandidateId(pair.candidateId);
        try {
            const result = await dismissDuplicateCandidate(pair.candidateId);
            if (result?.success) {
                setPairs(prev => prev?.filter(p => p.candidateId !== pair.candidateId) || []);
                setTotal(n => Math.max(0, n - 1));
                return;
            }

            // 'already_resolved' / 'not_found' mean the row on screen is STALE —
            // something else (usually a merge touching the same adopter) settled
            // this pair after the page loaded. Leaving the row visible after an
            // error is what made it look like the dismissal did nothing, so
            // reload instead of just complaining.
            const stale = result?.code === 'already_resolved' || result?.code === 'not_found';
            const message = result?.code === 'already_resolved' ? t('errors.dedup_already_resolved')
                : result?.code === 'not_found' ? t('errors.dedup_not_found')
                    : result?.code === 'not_authorized' ? t('errors.dedup_not_authorized')
                        : t('errors.dedup_dismiss_failed');

            if (stale) {
                // Not an error from the user's side: the pair IS resolved,
                // which is what they wanted. Success tone, list refreshed.
                toast.success(t('common.updated') || 'Actualizado', message);
                await load();
            } else {
                toast.error(t('errors.generic') || 'Error', message);
            }
        } catch (e) {
            toast.error(t('errors.generic') || 'Error', t('errors.dedup_dismiss_failed') || undefined, resolveErrorId(e, 'PendingDedup'));
        } finally {
            setBusyCandidateId(null);
        }
    };

    if (pairs === null) return null; // not loaded yet
    if (total === 0 && lowHidden === 0) return null;

    return (
        <section className="mb-8">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
                aria-controls="pending-dedup-list"
                className="w-full flex items-center gap-2 text-left group"
            >
                <svg className={`w-4 h-4 text-stone-400 transition-transform ${open ? 'rotate-90' : ''}`}
                    viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 5l6 5-6 5" />
                </svg>
                <h2 className="text-lg font-semibold text-stone-800 flex items-center gap-2 group-hover:text-stone-900">
                    {t('myAdopters.pending_dedup_title') || 'Pendientes de revisar'}
                    <span className="text-sm font-normal text-stone-500 bg-amber-50 px-2 py-0.5 rounded-full">{total}</span>
                </h2>
            </button>
            {!open && (
                <p className="text-sm text-stone-500 mt-1 ml-6">
                    {t('myAdopters.pending_dedup_subtitle') || 'Encontramos perfiles que podrían ser la misma persona. Decidí si combinarlos.'}
                </p>
            )}
            {!open ? null : (
            <>
            <p className="text-sm text-stone-500 mb-3 mt-1 ml-6">
                {t('myAdopters.pending_dedup_subtitle') || 'Encontramos perfiles que podrían ser la misma persona. Decidí si combinarlos.'}
            </p>
            <div id="pending-dedup-list" className="space-y-3">
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
                            </div>

                            {/* Why this pair was proposed — replaces the raw
                                "name_full, name_word" token dump. */}
                            <div className="mb-3">
                                <MatchedOn pair={pair} t={t} />
                            </div>

                            <div className="flex flex-col md:flex-row gap-3">
                                <AdopterCard side="new" adopter={pair.newAdopter} t={t} formatShortDate={formatShortDate} onRequestAccess={setAccessTarget} />
                                <div className="flex md:flex-col items-center justify-center text-stone-400 text-xs">↔</div>
                                <AdopterCard side="existing" adopter={pair.existingAdopter} t={t} formatShortDate={formatShortDate} onRequestAccess={setAccessTarget} />
                            </div>
                            <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                                {/* Dismiss writes to duplicate_candidates; a
                                    manually flagged pair has no row there, so
                                    the action is offered only for detected
                                    pairs rather than failing on click. */}
                                {pair.source === 'detected' && (
                                    <button
                                        type="button"
                                        onClick={() => handleDismiss(pair)}
                                        disabled={busy}
                                        className="px-3 py-2 text-[12px] font-semibold text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-xl transition-colors disabled:opacity-50"
                                    >
                                        {t('myAdopters.pending_dedup_action_keep') || 'Mantener separados'}
                                    </button>
                                )}
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

            {lowHidden > 0 && (
                <div className="mt-3 text-center">
                    <button
                        type="button"
                        onClick={() => { setShowLow(v => !v); setPage(1); }}
                        className="text-sm font-medium text-teal-700 hover:text-teal-800 underline underline-offset-2"
                    >
                        {showLow
                            ? (t('myAdopters.pending_dedup_hide_low') || 'Ocultar coincidencias débiles')
                            : (t('myAdopters.pending_dedup_show_low') || 'Ver coincidencias débiles').replace('{count}', String(lowHidden))}
                    </button>
                </div>
            )}

            {pageCount > 1 && (
                <div className="flex items-center justify-center gap-3 mt-4 text-sm">
                    <button
                        type="button"
                        onClick={() => setPage(n => Math.max(1, n - 1))}
                        disabled={page <= 1 || !!busyCandidateId}
                        className="px-3 py-1.5 rounded-lg bg-stone-100 text-stone-600 font-medium hover:bg-stone-200 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        ← {t('common.previous') || 'Anterior'}
                    </button>
                    <span className="text-stone-500 tabular-nums">
                        {page} / {pageCount}
                    </span>
                    <button
                        type="button"
                        onClick={() => setPage(n => Math.min(pageCount, n + 1))}
                        disabled={page >= pageCount || !!busyCandidateId}
                        className="px-3 py-1.5 rounded-lg bg-stone-100 text-stone-600 font-medium hover:bg-stone-200 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {t('common.next') || 'Siguiente'} →
                    </button>
                </div>
            )}
            </>
            )}

            {/* Reuses the existing owner-approval flow rather than a mailto: the
                owner gets a real request in PiiAccessRequestPanel and can grant
                it there. */}
            <RequestPiiAccessModal
                open={!!accessTarget}
                adopterId={accessTarget?.id || ''}
                adopterName={accessTarget?.name || ''}
                onClose={() => setAccessTarget(null)}
                onRequested={() => { setAccessTarget(null); load(); }}
            />
        </section>
    );
}
