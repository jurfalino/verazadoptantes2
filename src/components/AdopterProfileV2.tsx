'use client';

import { useMemo, useState } from 'react';
import { computeMaxDensityPeriod } from '@/lib/adoptionFilters';
import { useSearchParams } from 'next/navigation';
import { AdopterForm } from '@/components/AdopterForm';
import RequestPiiAccessModal from '@/components/RequestPiiAccessModal';
import PiiAccessRequestPanel from '@/components/PiiAccessRequestPanel';
import PiiAccessGrantsDisclosure from '@/components/PiiAccessGrantsDisclosure';
import PiiVerifyKnownInfo from '@/components/PiiVerifyKnownInfo';
import { CollapsibleSection } from '@/components/CollapsibleSection';
import AdoptionHistory from '@/components/AdoptionHistory';
import AdoptionFormWizard from '@/components/AdoptionFormWizard';
import AdoptionFormEditV2 from '@/components/AdoptionFormEditV2';
import VisitIntentCard from '@/components/VisitIntentCard';
import { useLanguage } from '@/context/LanguageContext';
import { saveImage, checkAdopterDeletable, deleteOwnAdopter, requestAdopterDeletion } from '@/app/actions';
import { ImageGallery } from '@/components/ImageGallery';
import { extractErrorId } from '@/lib/errorUtils';
import { DisclaimerToast } from '@/components/DisclaimerToast';
import { RatingBadge } from '@/components/RatingBadge';
import { useShowToast } from '@/components/ui/Toast';
import { useOneTimeNotice } from '@/hooks/useOneTimeNotice';
import { formatDateTime, formatShortDate, maskEmail } from '@/lib/dates';
import type { Adopter, AdopterImage, AdopterFlag, AdoptionRecord, HistoryEntry, AdopterStats, AdoptionConfig, DuplicateCandidateInfo } from '@/types/adopter';
import type { FormSubmissionPrefill } from '@/app/actions/formSubmission';
import type { AdopterPiiContext } from '@/lib/piiAccess';

interface AdopterProfileV2Props {
    id: string;
    isNew: boolean;
    adopter: Adopter | null;
    history: HistoryEntry[];
    adoptions: AdoptionRecord[];
    images: AdopterImage[];
    flags: AdopterFlag[];
    currentUser: string;
    availableAnimals: { id: string; animalName: string; species: string }[];
    stats?: AdopterStats | null;
    avgRating?: number | null;
    isAdmin?: boolean;
    adoptionConfig?: AdoptionConfig;
    duplicateCandidates?: DuplicateCandidateInfo[];
    formPrefill?: FormSubmissionPrefill | null;
    userNameMap?: Record<string, string>;
    piiContext?: AdopterPiiContext | null;
}

export function AdopterProfileV2({ id, isNew, adopter, history, adoptions, images, flags, currentUser, availableAnimals, stats, avgRating, isAdmin = false, adoptionConfig, duplicateCandidates = [], formPrefill = null, userNameMap = {}, piiContext = null }: AdopterProfileV2Props) {
    const { t } = useLanguage();
    const searchParams = useSearchParams();
    const toast = useShowToast();
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [deleteLoading, setDeleteLoading] = useState(false);
    const [requestModalOpen, setRequestModalOpen] = useState(false);
    const [requestSubmitted, setRequestSubmitted] = useState(false);
    // First-run "what's new" explainer on the protected-contact banner (Resolution #9).
    const { dismissed: piiNoticeDismissed, dismiss: dismissPiiNotice } = useOneTimeNotice('pii-access-gating-v1');
    const [deleteCheck, setDeleteCheck] = useState<{ canDelete: boolean; collaborators: { adoptions: number; images: number; edits: number; flags: number; forms: number } } | null>(null);

    const isOwner = adopter?.addedBy === currentUser;

    // PII opt-in is offered to a masked viewer with no request already in flight.
    const piiOptInEligible = !!piiContext?.masked
        && !requestSubmitted
        && !piiContext.requestState.pending
        && !piiContext.requestState.cooldownUntil;

    // VisitIntentCard is the canonical (and only) entry point for recording
    // activity on a profile (v2.14.8). After the wizard closes, the card
    // re-renders its options for the next record.

    // Density flags for wizard step-1 alerts (mirrors AdopterForm's computation).
    // Drives the optional "too many adoptions / too many requests" warnings shown
    // alongside the rating-bucket guidance copy. null when below threshold.
    const adoptionsThreshold = adoptionConfig?.threshold ?? 5;
    const adoptionsPeriodDays = adoptionConfig?.periodDays ?? 90;
    const requestsThreshold = adoptionConfig?.requestsThreshold ?? 3;
    const requestsPeriodDays = adoptionConfig?.requestsPeriodDays ?? 30;
    const tooManyAdoptions = useMemo(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const d = computeMaxDensityPeriod(adoptions as any, 'adoption', adoptionsPeriodDays);
        if (d.count < adoptionsThreshold) return null;
        return { count: d.count, actualSpanDays: d.timeSpanDays, periodDays: adoptionsPeriodDays };
    }, [adoptions, adoptionsThreshold, adoptionsPeriodDays]);
    const tooManyRequests = useMemo(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const d = computeMaxDensityPeriod(adoptions as any, 'adoption_request', requestsPeriodDays);
        if (d.count < requestsThreshold) return null;
        return { count: d.count, actualSpanDays: d.timeSpanDays, periodDays: requestsPeriodDays };
    }, [adoptions, requestsThreshold, requestsPeriodDays]);

    const handleDeleteClick = async () => {
        setDeleteLoading(true);
        try {
            const result = await checkAdopterDeletable(id);
            setDeleteCheck(result);
            setDeleteModalOpen(true);
        } catch (e) {
            toast.error(t('errors.generic'), t('adopter.delete_error_check'), extractErrorId(e));
        } finally {
            setDeleteLoading(false);
        }
    };

    const handleConfirmDelete = async () => {
        setDeleteLoading(true);
        try {
            await deleteOwnAdopter(id);
            toast.success('✓', t('adopter.delete_success'));
            window.location.href = '/';
        } catch (e) {
            toast.error(t('errors.generic'), t('errors.delete_failed_generic'), extractErrorId(e));
            setDeleteLoading(false);
        }
    };

    const handleRequestDeletion = async () => {
        setDeleteLoading(true);
        try {
            await requestAdopterDeletion(id);
            toast.success('✓', t('adopter.delete_request_success'));
            setDeleteModalOpen(false);
        } catch (e) {
            toast.error(t('errors.generic'), t('errors.delete_request_failed'), extractErrorId(e));
        } finally {
            setDeleteLoading(false);
        }
    };

    const ref = searchParams.get('ref');
    const backHref = ref === 'my-adopters' ? '/my-adopters' : '/';
    const backLabel = ref === 'my-adopters'
        ? (t('dashboard.my_adopters') || 'My Adopters')
        : (t('nav.back_to_search') || 'Back to Search');

    return (
        <main className="min-h-screen bg-teal-50 py-12 px-4 relative">
            <div className="max-w-3xl mx-auto space-y-5">

                {/* One-time legal disclaimer (localStorage-gated) */}
                {!isNew && adopter && <DisclaimerToast />}

                {/* Back Navigation */}
                <div className="mb-2">
                    <a href={backHref} className="inline-flex items-center gap-2 text-sm text-teal-700 hover:text-teal-800 transition-colors font-medium group">
                        <svg className="w-4 h-4 group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                        {backLabel}
                    </a>
                </div>

                {/* v39: pending-duplicate signal. Owner / admin gets the clickable
                    "Revisar" affordance straight to /my-adopters#pending-dedup
                    where the merge UI lives. Everyone else sees the same flag
                    informationally — non-owners can't act on someone else's record. */}
                {!isNew && adopter && duplicateCandidates && duplicateCandidates.length > 0 && (
                    (isOwner || isAdmin) ? (
                        <a
                            href="/my-adopters#pending-dedup"
                            className="block rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 transition-colors p-3 text-sm text-amber-900 flex items-center justify-between gap-3"
                        >
                            <span className="flex items-center gap-2 min-w-0">
                                <span aria-hidden>🔍</span>
                                <span className="font-semibold">
                                    {duplicateCandidates.length === 1
                                        ? (t('myAdopters.profile_pending_dup_one') || 'Posible duplicado detectado')
                                        : (t('myAdopters.profile_pending_dup_many') || '{n} posibles duplicados detectados').replace('{n}', String(duplicateCandidates.length))}
                                </span>
                            </span>
                            <span className="text-xs font-medium text-amber-800 flex-shrink-0">
                                {t('myAdopters.profile_pending_dup_review') || 'Revisar'} →
                            </span>
                        </a>
                    ) : (
                        <div
                            className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm text-stone-700 flex items-center gap-2"
                            title={t('myAdopters.profile_pending_dup_other_tooltip') || 'El sistema detectó otro registro similar. Solo el responsable del registro puede revisarlo.'}
                        >
                            <span aria-hidden>🔍</span>
                            <span>{t('myAdopters.profile_pending_dup_other') || 'Posible duplicado — el responsable del registro puede revisarlo.'}</span>
                        </div>
                    )
                )}

                {/* PII access gating — approver panel + masked-viewer request CTA.
                    Both surfaces are mutually exclusive: a privileged viewer sees
                    the panel, a masked viewer sees the CTA. */}
                {!isNew && adopter && piiContext?.gatingOn && (
                    <>
                        {piiContext.pendingRequests.length > 0 && (
                            <PiiAccessRequestPanel requests={piiContext.pendingRequests} />
                        )}
                        {piiContext.privileged && (
                            <PiiAccessGrantsDisclosure grants={piiContext.accessGrants} />
                        )}
                        {piiContext.masked && (
                            <div className="rounded-xl border border-teal-200 bg-teal-50 p-4 flex items-start gap-3">
                                <span aria-hidden className="text-lg">🔒</span>
                                <div className="flex-1 min-w-0 space-y-1.5">
                                    <p className="text-sm font-semibold text-teal-900">{t('adopter.pii_protected_title')}</p>
                                    <p className="text-sm text-teal-800">{t('adopter.pii_protected_body')}</p>
                                    {!piiNoticeDismissed && (
                                        <div className="border-t border-teal-200 pt-2 space-y-1.5">
                                            <p className="text-sm text-teal-800">
                                                <span className="font-semibold">{t('adopter.pii_whatsnew_label')}: </span>
                                                {t('adopter.pii_whatsnew_body')}
                                            </p>
                                            <button
                                                type="button"
                                                onClick={dismissPiiNotice}
                                                className="text-xs font-semibold text-teal-700 hover:opacity-70 transition-opacity"
                                            >
                                                {t('adopter.pii_whatsnew_dismiss')}
                                            </button>
                                        </div>
                                    )}
                                    {/* Self-serve unlock: type anything known about this
                                        person — phone, email, address, ID, @handle — and
                                        whatever matches across the masked entries unlocks.
                                        Always available (verify is independent of the
                                        request-access cooldown). */}
                                    <PiiVerifyKnownInfo adopterId={id} />
                                    {(requestSubmitted || piiContext.requestState.pending) ? (
                                        <p className="text-sm font-medium text-teal-700">{t('adopter.pii_request_pending')}</p>
                                    ) : piiContext.requestState.cooldownUntil ? (
                                        <p className="text-sm text-stone-500">
                                            {t('adopter.pii_request_cooldown').replace(
                                                '{date}',
                                                formatShortDate(new Date(piiContext.requestState.cooldownUntil)),
                                            )}
                                        </p>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => setRequestModalOpen(true)}
                                            className="text-sm text-stone-600 hover:text-teal-700 transition-colors"
                                        >
                                            {t('adopter.pii_request_cta_fallback')}
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}
                    </>
                )}

                {/* Profile Form */}
                <AdopterForm
                    initialData={adopter}
                    currentUser={currentUser}
                    images={images}
                    adopterId={id}
                    avgRating={avgRating}
                    profileViews={stats?.profileViews}
                    flags={flags}
                    adoptions={adoptions}
                    adoptionConfig={adoptionConfig}
                    isAdmin={isAdmin}
                    formPrefill={formPrefill}
                    hasDuplicateBanner={false}
                    canEdit={!piiContext?.gatingOn || piiContext.privileged}
                />

                {/* Adoptions — with Wizard Form */}
                {!isNew && adopter && (
                    <div id="adoptions-section" data-testid="adoptions-list">
                        {/* Visit-intent prompt sits above the section title — context-setting,
                            not part of the activity list. Suppressed for recently-acted users. */}
                        <VisitIntentCard
                            adopterId={id}
                            adopterName={adopter?.name}
                            avgRating={avgRating ?? null}
                            tooManyAdoptions={tooManyAdoptions}
                            tooManyRequests={tooManyRequests}
                            currentUser={currentUser}
                            adoptions={adoptions}
                            availableAnimals={availableAnimals}
                            adopterAddress={adopter?.contactInfo || ''}
                            piiOptInEligible={piiOptInEligible}
                        />
                        <CollapsibleSection
                            title={t('adoption.title')}
                            count={adoptions.length}
                            defaultOpen={true}
                        >
                            {/* AdoptionFormWizard renders here only for URL-driven autoOpen flows
                                (?newAdoption=...). The closed-state "Registrar Actividad" CTA was
                                removed in v2.14.8 — VisitIntentCard above is the canonical entry. */}
                            <AdoptionFormWizard
                                adopterId={id}
                                adopterName={adopter?.name || ''}
                                avgRating={avgRating ?? null}
                                tooManyAdoptions={tooManyAdoptions}
                                tooManyRequests={tooManyRequests}
                                availableAnimals={availableAnimals}
                                adopterAdoptions={adoptions}
                                currentUser={currentUser}
                                adopterAddress={adopter?.contactInfo || ''}
                                piiOptInEligible={piiOptInEligible}
                            />
                            <AdoptionHistory
                                adoptions={adoptions as any}
                                adopterId={id}
                                currentUser={currentUser}
                                isAdmin={isAdmin}
                                userNameMap={userNameMap}
                                adopterAddress={adopter?.contactInfo || ''}
                                editFormComponent={AdoptionFormEditV2}
                            />
                        </CollapsibleSection>
                    </div>
                )}

                {/* Photos */}
                {!isNew && adopter && (
                    <CollapsibleSection title={t('common.photos') || 'Photos'} count={images.length} defaultOpen={false}>
                        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-5">
                            <ImageGallery
                                adopterId={id}
                                initialImages={images as any}
                                onUpload={async (adopterId, url, caption, mediaType) => {
                                    return await saveImage(adopterId, url, caption, undefined, mediaType);
                                }}
                                currentUser={currentUser}
                                userNameMap={userNameMap}
                                isAdmin={isAdmin}
                            />
                        </div>
                    </CollapsibleSection>
                )}

                {/* History */}
                {!isNew && adopter && (
                    <CollapsibleSection title={t('audit.log_title') || 'History'} count={history.length} defaultOpen={false}>
                        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-5">
                            <h3 className="text-sm font-semibold text-teal-800 mb-4 uppercase tracking-wider flex items-center gap-2">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                {t('audit.log_title') || 'History Log'} <span className="text-stone-500 font-normal">({history.length} {t('audit.events') || 'events'})</span>
                            </h3>
                            {history.length > 0 ? (
                                <div className="space-y-4">
                                    {history.map((h) => {
                                        let changes: any = null;
                                        let eventType = 'update';
                                        try {
                                            const parsed = JSON.parse(h.changes as string);
                                            if (parsed.adoption_updated) { eventType = 'adoption_updated'; changes = parsed.adoption_updated; }
                                            else if (parsed.adoption_added) { eventType = 'adoption_added'; changes = parsed.adoption_added; }
                                            else if (parsed.adoption_deleted) { eventType = 'adoption_deleted'; changes = parsed.adoption_deleted; }
                                            else if (parsed.image_deleted) { eventType = 'image_deleted'; changes = parsed.image_deleted; }
                                            else { changes = parsed; }
                                        } catch { /* ignore */ }

                                        return (
                                            <div key={h.id} className="text-sm border-l-4 border-teal-200 pl-4 py-3 bg-teal-50 rounded-r-lg">
                                                <div className="flex justify-between items-start mb-2">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-teal-700 text-xs font-semibold uppercase tracking-wider">
                                                            {formatDateTime(new Date(h.changedAt as string | number))}
                                                        </span>
                                                        {eventType === 'adoption_added' && <span className="bg-teal-100 text-teal-700 text-xs px-2 py-0.5 rounded-full font-semibold uppercase">{t('audit.event_adoption_added')}</span>}
                                                        {eventType === 'adoption_deleted' && <span className="bg-rose-100 text-rose-700 text-xs px-2 py-0.5 rounded-full font-semibold uppercase">{t('audit.event_adoption_deleted')}</span>}
                                                        {eventType === 'image_deleted' && <span className="bg-rose-100 text-rose-700 text-xs px-2 py-0.5 rounded-full font-semibold uppercase">{t('audit.event_image_deleted')}</span>}
                                                    </div>
                                                    <span className="text-xs px-2.5 py-0.5 bg-white border border-teal-100 rounded-full text-teal-700 font-medium shadow-sm">
                                                        {t('audit.by')} {(h.changedBy && userNameMap?.[h.changedBy]) || (h.changedBy ? maskEmail(h.changedBy) : t('common.anonymous'))}
                                                    </span>
                                                </div>
                                                <div className="space-y-1.5">
                                                    {changes ? (
                                                        <>
                                                            {(eventType === 'update' || eventType === 'adoption_updated') && Object.entries(changes).map(([key, delta]: [string, any]) => (
                                                                <div key={key} className="grid grid-cols-[120px_1fr] gap-3 items-start text-sm">
                                                                    <span className="font-semibold text-teal-800 capitalize truncate" title={key}>{key.replace(/([A-Z])/g, ' $1').trim()}:</span>
                                                                    <div className="text-teal-700 break-words font-medium min-w-0">
                                                                        <div className="line-through text-rose-400 text-xs mr-2 opacity-70 inline-block max-w-full break-all line-clamp-3" title={typeof delta.from === 'string' ? delta.from : undefined}>
                                                                            {delta.from || t('audit.empty_val')}
                                                                        </div>
                                                                        <span className="text-teal-700 mr-2">➜</span>
                                                                        <span className="text-teal-900 bg-teal-100 px-1.5 rounded inline-block max-w-full break-all line-clamp-3 align-bottom" title={typeof delta.to === 'string' ? delta.to : undefined}>{delta.to || t('audit.empty_val')}</span>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                            {eventType === 'adoption_added' && (
                                                                <div className="text-teal-800 font-medium break-words">
                                                                    {t('audit.desc_adoption_added')} <span className="font-semibold break-all">{changes.animalName}</span> ({changes.species}) - {changes.status}
                                                                </div>
                                                            )}
                                                            {eventType === 'adoption_deleted' && (
                                                                <div className="space-y-1 text-teal-800 break-words">
                                                                    <div><span className="font-semibold">{t('adoption.animal_name')}:</span> <span className="break-all">{changes.animalName}</span> ({changes.species})</div>
                                                                    <div><span className="font-semibold">{t('adoption.status')}:</span> {changes.status}</div>
                                                                    <div className="flex items-center gap-1"><span className="font-semibold">{t('adoption.rating')}:</span> <RatingBadge rating={changes.rating} variant="inline" size="sm" /></div>
                                                                    {changes.details && <div className="text-xs italic mt-1 line-clamp-3 break-words" title={changes.details}>"{changes.details}"</div>}
                                                                </div>
                                                            )}
                                                            {eventType === 'image_deleted' && (
                                                                <div className="text-teal-800 break-words">
                                                                    {t('audit.desc_image_deleted')} <span className="italic opacity-75 break-all">"{changes.caption || t('common.untitled')}"</span> ({t('audit.by')} {formatShortDate(new Date(changes.uploadedAt))})
                                                                </div>
                                                            )}
                                                        </>
                                                    ) : (
                                                        <span className="text-teal-700 italic text-xs">{t('audit.metadata_update')}</span>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <p className="text-stone-500 text-sm italic">{t('audit.metadata_update') || 'No history entries.'}</p>
                            )}
                        </div>
                    </CollapsibleSection>
                )}

                {/* Delete record — owner only */}
                {!isNew && adopter && isOwner && (
                    <div className="pt-6 border-t border-stone-200 mt-6">
                        <button
                            onClick={handleDeleteClick}
                            disabled={deleteLoading}
                            className="flex items-center gap-2 text-sm text-rose-600 hover:text-rose-700 font-medium transition-colors disabled:opacity-50"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            {deleteLoading ? '...' : t('adopter.delete_record')}
                        </button>
                    </div>
                )}

                {/* Delete confirmation modal */}
                {deleteModalOpen && deleteCheck && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'var(--overlay-bg)' }}>
                        <div className="rounded-2xl p-6 max-w-md w-full shadow-xl space-y-4" style={{ background: 'var(--surface-card)' }}>
                            {deleteCheck.canDelete ? (
                                <>
                                    <h3 className="text-lg font-bold text-rose-600">{t('adopter.delete_confirm_title')}</h3>
                                    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t('adopter.delete_confirm_body')}</p>
                                    <div className="flex gap-3 pt-2">
                                        <button onClick={() => setDeleteModalOpen(false)} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors" style={{ background: 'var(--surface-muted)', color: 'var(--text-primary)' }}>{t('adopter.delete_cancel')}</button>
                                        <button onClick={handleConfirmDelete} disabled={deleteLoading} className="flex-1 px-4 py-2.5 bg-rose-600 text-white rounded-xl text-sm font-semibold hover:bg-rose-700 transition-colors disabled:opacity-50">{deleteLoading ? '...' : t('adopter.delete_confirm_btn')}</button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{t('adopter.delete_collab_title')}</h3>
                                    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t('adopter.delete_collab_body')}</p>
                                    <div className="text-xs space-y-1 rounded-xl p-3" style={{ background: 'var(--surface-muted)', color: 'var(--text-muted)' }}>
                                        <p className="font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{t('adopter.delete_collab_detail')}:</p>
                                        {deleteCheck.collaborators.adoptions > 0 && <p>• {deleteCheck.collaborators.adoptions} {t('adopter.delete_collab_adoptions')}</p>}
                                        {deleteCheck.collaborators.images > 0 && <p>• {deleteCheck.collaborators.images} {t('adopter.delete_collab_images')}</p>}
                                        {deleteCheck.collaborators.edits > 0 && <p>• {deleteCheck.collaborators.edits} {t('adopter.delete_collab_edits')}</p>}
                                        {deleteCheck.collaborators.flags > 0 && <p>• {deleteCheck.collaborators.flags} {t('adopter.delete_collab_flags')}</p>}
                                        {deleteCheck.collaborators.forms > 0 && <p>• {deleteCheck.collaborators.forms} {t('adopter.delete_collab_forms')}</p>}
                                    </div>
                                    <div className="flex gap-3 pt-2">
                                        <button onClick={() => setDeleteModalOpen(false)} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors" style={{ background: 'var(--surface-muted)', color: 'var(--text-primary)' }}>{t('adopter.delete_cancel')}</button>
                                        <button onClick={handleRequestDeletion} disabled={deleteLoading} className="flex-1 px-4 py-2.5 bg-rose-600 text-white rounded-xl text-sm font-semibold hover:bg-rose-700 transition-colors disabled:opacity-50">{deleteLoading ? '...' : t('adopter.delete_request_btn')}</button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )}

                {/* PII access request modal — masked viewers only */}
                {!isNew && adopter && piiContext?.masked && (
                    <RequestPiiAccessModal
                        adopterId={id}
                        adopterName={adopter.name}
                        open={requestModalOpen}
                        onClose={() => setRequestModalOpen(false)}
                        onRequested={() => setRequestSubmitted(true)}
                    />
                )}
            </div>
        </main>
    );
}
