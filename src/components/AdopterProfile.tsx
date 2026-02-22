'use client';

import { useState, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';

import { AdopterForm } from '@/components/AdopterForm';
import { CollapsibleSection } from '@/components/CollapsibleSection';
import AdoptionHistory from '@/components/AdoptionHistory';
import AdoptionForm from '@/components/AdoptionForm';
import { ImageGallery } from '@/components/ImageGallery';
import { useLanguage } from '@/context/LanguageContext';
import { saveImage } from '@/app/actions';
import ReportInaccuracyForm from '@/components/ReportInaccuracyForm';
import { countRecordsInPeriod } from '@/lib/adoptionFilters';
import type { Adopter, AdopterImage, AdopterFlag, AdoptionRecord, HistoryEntry, AdopterStats, AdoptionConfig, DuplicateCandidateInfo } from '@/types/adopter';

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
}

export function AdopterProfile({ id, isNew, adopter, history, adoptions, images, flags, currentUser, availableAnimals, stats, avgRating, isAdmin = false, adoptionConfig, duplicateCandidates = [] }: AdopterProfileProps) {
    const { t } = useLanguage();
    const searchParams = useSearchParams();
    const [selectedPeriod, setSelectedPeriod] = useState<'90d' | '1y' | 'all'>('all');
    const [dismissedDuplicates, setDismissedDuplicates] = useState<Set<string>>(new Set());
    const visibleDuplicates = duplicateCandidates.filter(c => !dismissedDuplicates.has(c.id));

    // Stable reference date for period filtering (avoids hydration mismatch)
    const referenceDate = useMemo(() => new Date(), []);
    const periodDaysMap = { '90d': 90, '1y': 365, 'all': Infinity };
    const days = periodDaysMap[selectedPeriod];
    const adoptionCountForPeriod = countRecordsInPeriod(adoptions, 'adoption', days, referenceDate);
    const requestCountForPeriod = countRecordsInPeriod(adoptions, 'adoption_request', days, referenceDate);

    // Determine back link based on referrer
    const ref = searchParams.get('ref');
    const backHref = ref === 'my-adopters' ? '/my-adopters' : '/';
    const backLabel = ref === 'my-adopters'
        ? (t('dashboard.my_adopters') || 'My Adopters')
        : (t('nav.back_to_search') || 'Back to Search');

    return (
        <main className="min-h-screen bg-emerald-50/30 py-12 px-4 relative">
            <div className="max-w-3xl mx-auto space-y-5">

                {/* Back Navigation */}
                <div className="mb-2">
                    <a href={backHref} className="inline-flex items-center gap-2 text-sm text-emerald-600/70 hover:text-emerald-800 transition-colors font-medium group">
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
                                        className="text-stone-400 hover:text-stone-600 p-1 transition-colors"
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
                        <div className="bg-white rounded-2xl p-5 shadow-sm border border-stone-200">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="font-bold text-stone-800">📊 {t('stats.profile_stats') || 'Profile Statistics'}</h3>
                                <div className="flex gap-1 bg-stone-100 rounded-lg p-1">
                                    {(['90d', '1y', 'all'] as const).map((period) => (
                                        <button
                                            key={period}
                                            onClick={() => setSelectedPeriod(period)}
                                            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${selectedPeriod === period
                                                ? 'bg-white text-stone-900 shadow-sm'
                                                : 'text-stone-500 hover:text-stone-700'
                                                }`}
                                        >
                                            {period === '90d' ? t('stats.period_90d') : period === '1y' ? t('stats.period_1y') : t('stats.period_all')}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div className={`text-center p-3 rounded-xl ${stats.searchHits[selectedPeriod] > 0 ? 'bg-blue-50' : 'bg-stone-50'}`}>
                                    <div className={`text-2xl font-bold ${stats.searchHits[selectedPeriod] > 0 ? 'text-blue-600' : 'text-stone-400'}`}>{stats.searchHits[selectedPeriod]}</div>
                                    <div className={`text-xs ${stats.searchHits[selectedPeriod] > 0 ? 'text-blue-600/70' : 'text-stone-400'}`}>🔍 {t('stats.searches') || 'Searches'}</div>
                                </div>
                                <div className={`text-center p-3 rounded-xl ${stats.profileViews[selectedPeriod] > 0 ? 'bg-purple-50' : 'bg-stone-50'}`}>
                                    <div className={`text-2xl font-bold ${stats.profileViews[selectedPeriod] > 0 ? 'text-purple-600' : 'text-stone-400'}`}>{stats.profileViews[selectedPeriod]}</div>
                                    <div className={`text-xs ${stats.profileViews[selectedPeriod] > 0 ? 'text-purple-600/70' : 'text-stone-400'}`}>👁 {t('stats.views') || 'Views'}</div>
                                </div>
                                <div className={`text-center p-3 rounded-xl ${requestCountForPeriod > 0 ? 'bg-orange-50' : 'bg-stone-50'}`}>
                                    <div className={`text-2xl font-bold ${requestCountForPeriod > 0 ? 'text-orange-600' : 'text-stone-400'}`}>{requestCountForPeriod}</div>
                                    <div className={`text-xs ${requestCountForPeriod > 0 ? 'text-orange-600/70' : 'text-stone-400'}`}>📝 {t('stats.requests') || 'Requests'}</div>
                                </div>
                                <div className={`text-center p-3 rounded-xl ${adoptionCountForPeriod > 0 ? 'bg-green-50' : 'bg-stone-50'}`}>
                                    <div className={`text-2xl font-bold ${adoptionCountForPeriod > 0 ? 'text-green-600' : 'text-stone-400'}`}>{adoptionCountForPeriod}</div>
                                    <div className={`text-xs ${adoptionCountForPeriod > 0 ? 'text-green-600/70' : 'text-stone-400'}`}>🏠 {t('stats.adoptions') || 'Adoptions'}</div>
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
                />

                {
                    !isNew && adopter && (
                        <>
                            {/* Images - Collapsible */}
                            <CollapsibleSection title={t('adopter.images')} count={images.length} defaultOpen={true}>
                                <ImageGallery
                                    adopterId={id}
                                    initialImages={images as any}
                                    onUpload={async (adopterId, url, caption) => {
                                        return await saveImage(adopterId, url, caption);
                                    }}
                                    currentUser={currentUser}
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
                                        adopterAddress={adopter?.contactInfo || ''}
                                    />
                                </CollapsibleSection>
                            </div>
                        </>
                    )
                }
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
