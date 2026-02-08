'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { AdopterForm } from '@/components/AdopterForm';
import { CollapsibleSection } from '@/components/CollapsibleSection';
import AdoptionHistory from '@/components/AdoptionHistory';
import AdoptionForm from '@/components/AdoptionForm';
import { ImageGallery } from '@/components/ImageGallery';
import { AdopterFlagging } from '@/components/AdopterFlagging';
import { useLanguage } from '@/context/LanguageContext';
import { saveImage } from '@/app/actions';
import { getRatingColors } from '@/lib/ratingColors';
import { StarRating } from '@/components/StarRating';

interface AdopterStats {
    searchHits: { '90d': number; '1y': number; 'all': number };
    profileViews: { '90d': number; '1y': number; 'all': number };
    adoptionRequests: { '90d': number; '1y': number; 'all': number };
    adoptionsCompleted: { '90d': number; '1y': number; 'all': number };
}

interface AdopterProfileProps {
    id: string;
    isNew: boolean;
    adopter: any;
    history: any[];
    adoptions: any[];
    images: any[];
    flags: any[];
    currentUser: string;
    availableAnimals: any[];
    stats?: AdopterStats | null;
    avgRating?: number | null;
    isAdmin?: boolean;
    adoptionConfig?: { threshold: number; periodDays: number; requestsThreshold: number; requestsPeriodDays: number };
}

export function AdopterProfile({ id, isNew, adopter, history, adoptions, images, flags, currentUser, availableAnimals, stats, avgRating, isAdmin = false, adoptionConfig }: AdopterProfileProps) {
    const { t } = useLanguage();
    const searchParams = useSearchParams();
    const [selectedPeriod, setSelectedPeriod] = useState<'90d' | '1y' | 'all'>('all');

    // Calculate adoptions in configured period for "too many adoptions" warning
    const periodDays = adoptionConfig?.periodDays || 90;
    const threshold = adoptionConfig?.threshold || 5;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - periodDays);
    const adoptionsInPeriod = adoptions.filter((a: { date?: Date | number; recordType?: string }) => {
        if (a.recordType !== 'adoption') return false;
        if (!a.date) return false;
        const adoptionDate = typeof a.date === 'number' ? new Date(a.date * 1000) : new Date(a.date);
        return adoptionDate >= cutoffDate;
    }).length;

    // Calculate requests in configured period for "too many requests" warning
    const requestsPeriodDays = adoptionConfig?.requestsPeriodDays || 30;
    const requestsThreshold = adoptionConfig?.requestsThreshold || 3;
    const requestsCutoffDate = new Date();
    requestsCutoffDate.setDate(requestsCutoffDate.getDate() - requestsPeriodDays);
    const requestsInPeriod = adoptions.filter((a: { date?: Date | number; recordType?: string }) => {
        if (a.recordType !== 'adoption_request') return false;
        if (!a.date) return false;
        const requestDate = typeof a.date === 'number' ? new Date(a.date * 1000) : new Date(a.date);
        return requestDate >= requestsCutoffDate;
    }).length;

    // Determine back link based on referrer
    const ref = searchParams.get('ref');
    const backHref = ref === 'my-adopters' ? '/my-adopters' : '/';
    const backLabel = ref === 'my-adopters'
        ? (t('dashboard.my_adopters') || 'My Adopters')
        : (t('nav.back_to_search') || 'Back to Search');

    return (
        <main className="min-h-screen bg-emerald-50/30 py-12 px-4 relative">
            <div className="max-w-3xl mx-auto space-y-8">

                {/* Back Navigation */}
                <div className="mb-2">
                    <a href={backHref} className="inline-flex items-center gap-2 text-sm text-emerald-600/70 hover:text-emerald-800 transition-colors font-medium group">
                        <svg className="w-4 h-4 group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                        {backLabel}
                    </a>
                </div>

                {!isNew && adopter && (
                    <AdopterFlagging
                        adopterId={id}
                        adopterName={adopter.name}
                        existingFlags={flags}
                        hasVerifiedAdoption={adoptions.some((a: { identityVerified?: number }) => a.identityVerified === 1)}
                        hasVerifiedAddress={adoptions.some((a: { verifiedAddress?: string }) => a.verifiedAddress && a.verifiedAddress.trim() !== '')}
                        tooManyAdoptions={adoptionsInPeriod >= threshold ? { count: adoptionsInPeriod, threshold, periodDays } : undefined}
                        tooManyRequests={requestsInPeriod >= requestsThreshold ? { count: requestsInPeriod, threshold: requestsThreshold, periodDays: requestsPeriodDays } : undefined}
                    />
                )}

                <header className="flex flex-wrap justify-between items-end px-2 gap-4">
                    <div className="flex items-center gap-4">
                        {/* Profile Picture Thumbnail */}
                        {!isNew && images.length > 0 && (() => {
                            const profilePic = images.find((img: { isProfilePicture?: number }) => img.isProfilePicture === 1) || images[0];
                            return (
                                <div className="w-16 h-16 rounded-2xl bg-emerald-100 overflow-hidden ring-2 ring-emerald-200 shadow-md flex-shrink-0">
                                    <img src={profilePic.url} alt="" className="w-full h-full object-cover" />
                                </div>
                            );
                        })()}
                        <div>
                            <h1 className="text-3xl md:text-4xl font-extrabold text-emerald-950 tracking-tight">
                                {t('adopter.title_profile')}
                            </h1>
                            {!isNew && (
                                <div className="mt-1 space-y-1">
                                    <p className="text-emerald-600/80 font-medium text-sm">{t('adopter.id')}: <span className="font-mono text-emerald-500/60">{id}</span></p>
                                    {adopter.sourceUrl && (
                                        <div className="flex items-center gap-1.5">
                                            <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 24 24"><path d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.879V14.89h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.989C18.343 21.129 22 16.99 22 12z" /></svg>
                                            <a href={adopter.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-700 hover:underline text-sm font-medium transition-colors">
                                                {t('adopter.view_source') || 'View Original Input'}
                                            </a>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                    {/* Average Rating Badge */}
                    {avgRating !== null && avgRating !== undefined && (() => {
                        const colors = getRatingColors(avgRating);
                        return (
                            <div
                                data-testid="rating-badge"
                                onClick={() => document.getElementById('adoptions-section')?.scrollIntoView({ behavior: 'smooth' })}
                                className={`${colors.bg} border ${colors.border} rounded-xl px-4 py-2 text-center cursor-pointer hover:shadow-md transition-shadow`}
                            >
                                <StarRating value={Math.round(avgRating)} size="md" />
                                <div className={`${colors.text} font-bold text-lg mt-1`}>{avgRating.toFixed(1)}</div>
                                <div className={`${colors.text} opacity-70 text-xs`}>{t('stats.avg_rating') || 'Avg Rating'}</div>
                            </div>
                        );
                    })()}
                </header>

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
                                            {period === '90d' ? '90 Days' : period === '1y' ? '1 Year' : 'All Time'}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div className="text-center p-3 bg-blue-50 rounded-xl">
                                    <div className="text-2xl font-bold text-blue-600">{stats.searchHits[selectedPeriod]}</div>
                                    <div className="text-xs text-blue-600/70">🔍 {t('stats.searches') || 'Searches'}</div>
                                </div>
                                <div className="text-center p-3 bg-purple-50 rounded-xl">
                                    <div className="text-2xl font-bold text-purple-600">{stats.profileViews[selectedPeriod]}</div>
                                    <div className="text-xs text-purple-600/70">👁 {t('stats.views') || 'Views'}</div>
                                </div>
                                <div className="text-center p-3 bg-orange-50 rounded-xl">
                                    <div className="text-2xl font-bold text-orange-600">{stats.adoptionRequests[selectedPeriod]}</div>
                                    <div className="text-xs text-orange-600/70">📝 {t('stats.requests') || 'Requests'}</div>
                                </div>
                                <div className="text-center p-3 bg-green-50 rounded-xl">
                                    <div className="text-2xl font-bold text-green-600">{stats.adoptionsCompleted[selectedPeriod]}</div>
                                    <div className="text-xs text-green-600/70">🏠 {t('stats.adoptions') || 'Adoptions'}</div>
                                </div>
                            </div>
                        </div>
                    )
                }

                <AdopterForm initialData={adopter} history={history} currentUser={currentUser} />

                {
                    !isNew && adopter && (
                        <>
                            {/* Images - Collapsible */}
                            <CollapsibleSection title={t('adopter.images')} count={images.length} defaultOpen={true}>
                                <ImageGallery
                                    adopterId={id}
                                    initialImages={images}
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
                                        adoptions={adoptions}
                                        onEdit={() => { }}
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
            </div >
        </main >
    );
}
