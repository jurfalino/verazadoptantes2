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
import { getSourceIcon } from '@/lib/sourceIcons'; // Added this import
import { StarRating } from '@/components/StarRating';
import ReportInaccuracyForm from '@/components/ReportInaccuracyForm';

interface AdopterStats {
    searchHits: { '90d': number; '1y': number; 'all': number };
    profileViews: { '90d': number; '1y': number; 'all': number };
}

interface DuplicateCandidateInfo {
    id: string;
    otherAdopterId: string;
    otherAdopterName: string;
    matchTypes: string[];
    score: number;
    confidence: string;
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
    duplicateCandidates?: DuplicateCandidateInfo[];
}

export function AdopterProfile({ id, isNew, adopter, history, adoptions, images, flags, currentUser, availableAnimals, stats, avgRating, isAdmin = false, adoptionConfig, duplicateCandidates = [] }: AdopterProfileProps) {
    const { t } = useLanguage();
    const searchParams = useSearchParams();
    const [selectedPeriod, setSelectedPeriod] = useState<'90d' | '1y' | 'all'>('all');
    const [dismissedDuplicates, setDismissedDuplicates] = useState<Set<string>>(new Set());
    const visibleDuplicates = duplicateCandidates.filter(c => !dismissedDuplicates.has(c.id));

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

    // Period-filtered counts for the stats header
    const periodDaysMap = { '90d': 90, '1y': 365, 'all': Infinity };
    const filterByPeriod = (type: string) => {
        const days = periodDaysMap[selectedPeriod];
        return adoptions.filter((a: { date?: Date | number; recordType?: string }) => {
            if (a.recordType !== type) return false;
            if (days === Infinity) return true;
            if (!a.date) return false;
            const d = typeof a.date === 'number' ? new Date(a.date * 1000) : new Date(a.date);
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - days);
            return d >= cutoff;
        }).length;
    };
    const adoptionCountForPeriod = filterByPeriod('adoption');
    const requestCountForPeriod = filterByPeriod('adoption_request');

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

                {/* Community data disclaimer + report form */}
                {!isNew && adopter && (
                    <ReportInaccuracyForm adopterId={id} adopterName={adopter.name} />
                )}

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
                                            <span className="text-blue-600">{getSourceIcon(adopter.sourceUrl, 'w-4 h-4')}</span>
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
                                    <div className="text-2xl font-bold text-orange-600">{requestCountForPeriod}</div>
                                    <div className="text-xs text-orange-600/70">📝 {t('stats.requests') || 'Requests'}</div>
                                </div>
                                <div className="text-center p-3 bg-green-50 rounded-xl">
                                    <div className="text-2xl font-bold text-green-600">{adoptionCountForPeriod}</div>
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
