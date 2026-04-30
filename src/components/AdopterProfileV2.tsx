'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AdopterForm } from '@/components/AdopterForm';
import { CollapsibleSection } from '@/components/CollapsibleSection';
import AdoptionHistory from '@/components/AdoptionHistory';
import AdoptionFormWizard from '@/components/AdoptionFormWizard';
import AdoptionFormEditV2 from '@/components/AdoptionFormEditV2';
import { useLanguage } from '@/context/LanguageContext';
import { saveImage, checkAdopterDeletable, deleteOwnAdopter, requestAdopterDeletion } from '@/app/actions';
import { ImageGallery } from '@/components/ImageGallery';
import ReportInaccuracyForm from '@/components/ReportInaccuracyForm';
import DuplicateComparisonCard from '@/components/DuplicateComparisonCard';
import { RatingBadge } from '@/components/RatingBadge';
import { useShowToast } from '@/components/ui/Toast';
import { formatDateTime, formatShortDate, maskEmail } from '@/lib/dates';
import type { Adopter, AdopterImage, AdopterFlag, AdoptionRecord, HistoryEntry, AdopterStats, AdoptionConfig, DuplicateCandidateInfo } from '@/types/adopter';
import type { FormSubmissionPrefill } from '@/app/actions/formSubmission';

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
}

export function AdopterProfileV2({ id, isNew, adopter, history, adoptions, images, flags, currentUser, availableAnimals, stats, avgRating, isAdmin = false, adoptionConfig, duplicateCandidates = [], formPrefill = null, userNameMap = {} }: AdopterProfileV2Props) {
    const { t } = useLanguage();
    const searchParams = useSearchParams();
    const toast = useShowToast();
    const [dismissedDuplicates, setDismissedDuplicates] = useState<Set<string>>(new Set());
    const [expandedDuplicateId, setExpandedDuplicateId] = useState<string | null>(null);
    const visibleDuplicates = duplicateCandidates.filter(c => !dismissedDuplicates.has(c.id));

    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [deleteLoading, setDeleteLoading] = useState(false);
    const [deleteCheck, setDeleteCheck] = useState<{ canDelete: boolean; collaborators: { adoptions: number; images: number; edits: number; flags: number; forms: number } } | null>(null);

    const isOwner = adopter?.addedBy === currentUser;

    const handleDeleteClick = async () => {
        setDeleteLoading(true);
        try {
            const result = await checkAdopterDeletable(id);
            setDeleteCheck(result);
            setDeleteModalOpen(true);
        } catch {
            toast.error('Error', t('adopter.delete_error_check'));
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
        } catch {
            toast.error('Error', t('adopter.delete_error_failed'));
            setDeleteLoading(false);
        }
    };

    const handleRequestDeletion = async () => {
        setDeleteLoading(true);
        try {
            await requestAdopterDeletion(id);
            toast.success('✓', t('adopter.delete_request_success'));
            setDeleteModalOpen(false);
        } catch {
            toast.error('Error', t('adopter.delete_error_request'));
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

                {/* Back Navigation */}
                <div className="mb-2">
                    <a href={backHref} className="inline-flex items-center gap-2 text-sm text-teal-700 hover:text-teal-800 transition-colors font-medium group">
                        <svg className="w-4 h-4 group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                        {backLabel}
                    </a>
                </div>

                {/* Duplicate Detection Banner */}
                {!isNew && visibleDuplicates.length > 0 && (
                    <div className="space-y-2">
                        {visibleDuplicates.map(dup => (
                            <div key={dup.id} className="bg-amber-50 border border-amber-200 rounded-2xl p-4 shadow-sm">
                                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                                    <div className="flex items-start gap-3 flex-1 min-w-0">
                                        <span className="text-xl mt-0.5">⚠️</span>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-semibold text-amber-900">
                                                {t('duplicates.possible_match') || 'Possible duplicate of'}{' '}
                                                <a href={`/adopter/${dup.otherAdopterId}`} className="underline text-blue-700 hover:text-blue-800">
                                                    {dup.otherAdopterName}
                                                </a>
                                            </p>
                                            <div className="flex flex-wrap gap-1.5 mt-2">
                                                {dup.matchTypes.map((type: string) => (
                                                    <span key={type} className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${getMatchBadgeStyle(type)}`}>
                                                        {getMatchLabel(type)}
                                                    </span>
                                                ))}
                                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${dup.confidence === 'high' ? 'bg-red-100 text-red-700' :
                                                    dup.confidence === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                                                        'bg-stone-100 text-stone-600'
                                                    }`}>
                                                    {dup.confidence}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap w-full sm:w-auto mt-1 sm:mt-0 pt-2 sm:pt-0 border-t sm:border-0 border-amber-200/50">
                                        <button
                                            onClick={() => setExpandedDuplicateId(expandedDuplicateId === dup.otherAdopterId ? null : dup.otherAdopterId)}
                                            className="text-xs px-3 py-2 sm:py-1.5 bg-stone-200 text-stone-800 rounded-lg font-medium hover:bg-stone-300 transition-colors flex-1 sm:flex-none text-center"
                                        >
                                            {expandedDuplicateId === dup.otherAdopterId ? '▲ Ocultar' : '▼ Comparar'}
                                        </button>
                                        <a
                                            href={`/adopter/${dup.otherAdopterId}`}
                                            className="text-xs px-3 py-2 sm:py-1.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors flex-1 sm:flex-none text-center"
                                        >
                                            {t('duplicates.view_profile') || 'View →'}
                                        </a>
                                        <button
                                            onClick={() => setDismissedDuplicates(prev => new Set(prev).add(dup.id))}
                                            className="text-stone-500 hover:text-stone-600 p-2 sm:p-1 transition-colors ml-auto sm:ml-0"
                                            title={t('duplicates.dismiss') || 'Dismiss'}
                                        >
                                            ✕
                                        </button>
                                    </div>
                                </div>
                                {expandedDuplicateId === dup.otherAdopterId && !isNew && adopter && (
                                    <div className="mt-4 pt-4 border-t border-amber-200">
                                        <DuplicateComparisonCard
                                            currentAdopter={adopter}
                                            currentImages={images}
                                            otherAdopterId={dup.otherAdopterId}
                                            onClose={() => setExpandedDuplicateId(null)}
                                        />
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
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
                    hasDuplicateBanner={visibleDuplicates.length > 0}
                />

                {!isNew && adopter && (
                    <ReportInaccuracyForm adopterId={id} adopterName={adopter.name} />
                )}

                {/* Adoptions */}
                {!isNew && adopter && (
                    <div id="adoptions-section" data-testid="adoptions-list">
                        <CollapsibleSection
                            title={t('adoption.title')}
                            count={adoptions.length}
                            defaultOpen={true}
                        >
                            <AdoptionFormWizard
                                adopterId={id}
                                availableAnimals={availableAnimals}
                                currentUser={currentUser}
                                adopterAddress={adopter?.contactInfo || ''}
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
                    <CollapsibleSection
                        title={t('audit.log_title') || 'History'}
                        count={history.length}
                        defaultOpen={false}
                    >
                        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-5">
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
                                                                    <div className="text-teal-700 break-words font-medium">
                                                                        <div className="line-through text-rose-400 text-xs mr-2 opacity-70 inline-block">
                                                                            {typeof delta.from === 'string' && delta.from.length > 30 ? delta.from.substring(0, 30) + '...' : (delta.from || t('audit.empty_val'))}
                                                                        </div>
                                                                        <span className="text-teal-700 mr-2">➜</span>
                                                                        <span className="text-teal-900 bg-teal-100 px-1.5 rounded">
                                                                            {delta.to || t('audit.empty_val')}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                            {eventType === 'adoption_added' && (
                                                                <div className="text-teal-800 font-medium">
                                                                    {t('audit.desc_adoption_added')} <span className="font-semibold">{changes.animalName}</span> ({changes.species}) - {changes.status}
                                                                </div>
                                                            )}
                                                            {eventType === 'adoption_deleted' && (
                                                                <div className="space-y-1 text-teal-800">
                                                                    <div><span className="font-semibold">{t('adoption.animal_name')}:</span> {changes.animalName} ({changes.species})</div>
                                                                    <div><span className="font-semibold">{t('adoption.status')}:</span> {changes.status}</div>
                                                                    <div className="flex items-center gap-1"><span className="font-semibold">{t('adoption.rating')}:</span> <RatingBadge rating={changes.rating} variant="inline" size="sm" /></div>
                                                                    {changes.details && <div className="text-xs italic mt-1">"{changes.details}"</div>}
                                                                </div>
                                                            )}
                                                            {eventType === 'image_deleted' && (
                                                                <div className="text-teal-800">
                                                                    {t('audit.desc_image_deleted')} <span className="italic opacity-75">"{changes.caption || t('common.untitled')}"</span> ({t('audit.by')} {formatShortDate(new Date(changes.uploadedAt))})
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
                                        <button
                                            onClick={() => setDeleteModalOpen(false)}
                                            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors" style={{ background: 'var(--surface-muted)', color: 'var(--text-primary)' }}
                                        >{t('adopter.delete_cancel')}</button>
                                        <button
                                            onClick={handleConfirmDelete}
                                            disabled={deleteLoading}
                                            className="flex-1 px-4 py-2.5 bg-rose-600 text-white rounded-xl text-sm font-semibold hover:bg-rose-700 transition-colors disabled:opacity-50"
                                        >{deleteLoading ? '...' : t('adopter.delete_confirm_btn')}</button>
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
                                        <button
                                            onClick={() => setDeleteModalOpen(false)}
                                            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors" style={{ background: 'var(--surface-muted)', color: 'var(--text-primary)' }}
                                        >{t('adopter.delete_cancel')}</button>
                                        <button
                                            onClick={handleRequestDeletion}
                                            disabled={deleteLoading}
                                            className="flex-1 px-4 py-2.5 bg-rose-600 text-white rounded-xl text-sm font-semibold hover:bg-rose-700 transition-colors disabled:opacity-50"
                                        >{deleteLoading ? '...' : t('adopter.delete_request_btn')}</button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </main>
    );
}

function getMatchLabel(type: string): string {
    const labels: Record<string, string> = {
        phone: '📞 Phone', phone_suffix: '📞 Phone',
        email: '✉️ Email', social: '🌐 Social',
        name_full: '📛 Full Name', name_word: '📝 Name',
        address_word: '🏠 Address', source_url: '🔗 Source URL',
    };
    return labels[type] || type;
}

function getMatchBadgeStyle(type: string): string {
    const styles: Record<string, string> = {
        phone: 'bg-blue-100 text-blue-700', phone_suffix: 'bg-blue-100 text-blue-700',
        email: 'bg-purple-100 text-purple-700', social: 'bg-cyan-100 text-cyan-700',
        name_full: 'bg-amber-100 text-amber-700', name_word: 'bg-orange-100 text-orange-700',
        address_word: 'bg-green-100 text-green-700', source_url: 'bg-rose-100 text-rose-700',
    };
    return styles[type] || 'bg-stone-100 text-stone-700';
}
