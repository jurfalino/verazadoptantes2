'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { AdopterForm } from '@/components/AdopterForm';
import { CollapsibleSection } from '@/components/CollapsibleSection';
import AdoptionHistory from '@/components/AdoptionHistory';
import AdoptionForm from '@/components/AdoptionForm';
import { ImageGallery } from '@/components/ImageGallery';
import { useLanguage } from '@/context/LanguageContext';
import { saveImage } from '@/app/actions';
import { checkAdopterDeletable, deleteOwnAdopter, requestAdopterDeletion } from '@/app/actions';
import { useShowToast } from '@/components/ui/Toast';
import ReportInaccuracyForm from '@/components/ReportInaccuracyForm';
import type { Adopter, AdopterImage, AdopterFlag, AdoptionRecord, HistoryEntry, AdopterStats, AdoptionConfig, DuplicateCandidateInfo } from '@/types/adopter';
import type { FormSubmissionPrefill } from '@/app/actions/formSubmission';

interface AdopterProfileProps {
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
    linkedForms?: Array<{ id: string; species: string | null; lifeStage: string | null; notificationId: string | null; answersJson: string | null; createdAt: Date | null }>;
    formPrefill?: FormSubmissionPrefill | null;
    userNameMap?: Record<string, string>;
}

export function AdopterProfile({ id, isNew, adopter, history, adoptions, images, flags, currentUser, availableAnimals, stats, avgRating, isAdmin = false, adoptionConfig, duplicateCandidates = [], linkedForms = [], formPrefill = null, userNameMap = {} }: AdopterProfileProps) {
    const { t } = useLanguage();
    const searchParams = useSearchParams();
    const toast = useShowToast();
    const [dismissedDuplicates, setDismissedDuplicates] = useState<Set<string>>(new Set());
    const visibleDuplicates = duplicateCandidates.filter(c => !dismissedDuplicates.has(c.id));

    // Delete state
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

    // Compute adoption/request counts from the adoptions array directly
    const adoptionCount = adoptions.filter(a => a.recordType === 'adoption').length;
    const requestCount = adoptions.filter(a => a.recordType === 'adoption_request').length;

    // Determine back link based on referrer
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

                {!isNew && adopter && (
                    <ReportInaccuracyForm adopterId={id} adopterName={adopter.name} />
                )}

                {/* Duplicate Detection Banner */}
                {!isNew && visibleDuplicates.length > 0 && (
                    <div className="space-y-2">
                        {visibleDuplicates.map(dup => (
                            <div key={dup.id} className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3 shadow-sm">
                                <span className="text-xl mt-0.5">⚠️</span>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-amber-900">
                                        {t('duplicates.possible_match') || 'Possible duplicate of'}{' '}
                                        <a href={`/adopter/${dup.otherAdopterId}`} className="underline text-blue-700 hover:text-blue-800">
                                            {dup.otherAdopterName}
                                        </a>
                                    </p>
                                    <div className="flex flex-wrap gap-1 mt-1.5">
                                        {dup.matchTypes.map(type => (
                                            <span key={type} className={`text-xs px-2 py-0.5 rounded-full font-medium ${getMatchBadgeStyle(type)}`}>
                                                {getMatchLabel(type)}
                                            </span>
                                        ))}
                                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${dup.confidence === 'high' ? 'bg-red-100 text-red-700' :
                                            dup.confidence === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                                                'bg-stone-100 text-stone-600'
                                            }`}>
                                            {dup.confidence}
                                        </span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                    <a
                                        href={`/adopter/${dup.otherAdopterId}`}
                                        className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
                                    >
                                        {t('duplicates.view_profile') || 'View →'}
                                    </a>
                                    <button
                                        onClick={() => setDismissedDuplicates(prev => new Set(prev).add(dup.id))}
                                        className="text-stone-500 hover:text-stone-600 p-1 transition-colors"
                                        title={t('duplicates.dismiss') || 'Dismiss'}
                                    >
                                        ✕
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}


                {/* Stats Table */}
                {
                    stats && !isNew && (
                        <div className="stats-card">
                            <div className="stats-header">
                                <h3 className="stats-title">📊 {t('stats.profile_stats') || 'Profile Statistics'}</h3>
                            </div>
                            <div className="stats-grid">
                                {/* Views */}
                                <div
                                    className={`stats-tile ${stats.profileViews > 0 ? 'stats-tile--purple' : 'stats-tile--muted'}`}
                                >
                                    <div className="stats-tile-icon">
                                        <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M1 8s2.545-5 7-5 7 5 7 5-2.545 5-7 5-7-5-7-5Z" />
                                            <circle cx="8" cy="8" r="2" />
                                        </svg>
                                    </div>
                                    <div className="stats-tile-content">
                                        <div className="stats-tile-value">
                                            {stats.profileViews}
                                        </div>
                                        <div className="stats-tile-label">
                                            {t('stats.views') || 'Views'}
                                        </div>
                                    </div>
                                </div>
                                {/* Requests */}
                                <div
                                    className={`stats-tile ${requestCount > 0 ? 'stats-tile--orange' : 'stats-tile--muted'}`}
                                >
                                    <div className="stats-tile-icon">
                                        <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                                            <rect x="3" y="1" width="10" height="14" rx="1.5" />
                                            <path d="M6 5h4M6 8h4M6 11h2" strokeLinecap="round" />
                                        </svg>
                                    </div>
                                    <div className="stats-tile-content">
                                        <div className="stats-tile-value">
                                            {requestCount}
                                        </div>
                                        <div className="stats-tile-label">
                                            {t('stats.requests') || 'Requests'}
                                        </div>
                                    </div>
                                </div>
                                {/* Adoptions */}
                                <div
                                    className={`stats-tile ${adoptionCount > 0 ? 'stats-tile--green' : 'stats-tile--muted'}`}
                                >
                                    <div className="stats-tile-icon">
                                        <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M2.5 8.5L8 3l5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
                                            <path d="M3.5 7.5V13a1 1 0 001 1h7a1 1 0 001-1V7.5" />
                                        </svg>
                                    </div>
                                    <div className="stats-tile-content">
                                        <div className="stats-tile-value">
                                            {adoptionCount}
                                        </div>
                                        <div className="stats-tile-label">
                                            {t('stats.adoptions') || 'Adoptions'}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )
                }

                <AdopterForm
                    initialData={adopter}
                    history={history}
                    currentUser={currentUser}
                    images={images}
                    adopterId={id}
                    avgRating={avgRating}
                    flags={flags}
                    adoptions={adoptions}
                    adoptionConfig={adoptionConfig}
                    isAdmin={isAdmin}
                    formPrefill={formPrefill}
                    userNameMap={userNameMap}
                />

                {
                    !isNew && adopter && (
                        <>
                            {/* Images - Collapsible */}
                            <CollapsibleSection title={t('adopter.images')} count={images.length} defaultOpen={true}>
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
                            </CollapsibleSection>

                            {/* Adoptions - Collapsible */}
                            <div id="adoptions-section" data-testid="adoptions-list">
                                <CollapsibleSection title={t('adoption.title')} count={adoptions.length} defaultOpen={true}>
                                    <AdoptionForm
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
                                    />
                                </CollapsibleSection>
                            </div>
                        </>
                    )
                }




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
