'use client';

import { useSearchParams } from 'next/navigation';
import { AdopterForm } from '@/components/AdopterForm';
import { CollapsibleSection } from '@/components/CollapsibleSection';
import AdoptionHistory from '@/components/AdoptionHistory';
import AdoptionFormWizard from '@/components/AdoptionFormWizard';
import AdoptionFormEditV2 from '@/components/AdoptionFormEditV2';
import { useLanguage } from '@/context/LanguageContext';
import { saveImage } from '@/app/actions';
import { ImageGallery } from '@/components/ImageGallery';
import ReportInaccuracyForm from '@/components/ReportInaccuracyForm';
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

export function AdopterProfileV2({ id, isNew, adopter, history, adoptions, images, flags, currentUser, availableAnimals, stats, avgRating, isAdmin = false, adoptionConfig, formPrefill = null, userNameMap = {} }: AdopterProfileV2Props) {
    const { t } = useLanguage();
    const searchParams = useSearchParams();

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
                    {/* V2 badge */}
                    <span className="ml-3 text-xs px-2 py-0.5 bg-violet-100 text-violet-700 rounded-full font-semibold">v2 Wizard</span>
                </div>

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
                />

                {!isNew && adopter && (
                    <ReportInaccuracyForm adopterId={id} adopterName={adopter.name} />
                )}

                {/* Adoptions — with Wizard Form */}
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
            </div>
        </main>
    );
}
