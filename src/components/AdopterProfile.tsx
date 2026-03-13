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
}

export function AdopterProfile({ id, isNew, adopter, history, adoptions, images, flags, currentUser, availableAnimals, stats, avgRating, isAdmin = false, adoptionConfig, duplicateCandidates = [], linkedForms = [], formPrefill = null }: AdopterProfileProps) {
    const { t } = useLanguage();
    const searchParams = useSearchParams();
    const [selectedPeriod, setSelectedPeriod] = useState<'90d' | '1y' | 'all'>('all');
    const [dismissedDuplicates, setDismissedDuplicates] = useState<Set<string>>(new Set());
    const [expandedStat, setExpandedStat] = useState<string | null>(null);
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
        <main className="min-h-screen bg-teal-50/30 py-12 px-4 relative">
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
                                <div className="stats-tab-bar">
                                    {(['90d', '1y', 'all'] as const).map((period) => (
                                        <button
                                            key={period}
                                            onClick={() => setSelectedPeriod(period)}
                                            className={`stats-tab ${selectedPeriod === period ? 'stats-tab--active' : ''}`}
                                        >
                                            {period === '90d' ? t('stats.period_90d') : period === '1y' ? t('stats.period_1y') : t('stats.period_all')}
                                        </button>
                                    ))}
                                </div>
                                <select
                                    className="stats-period-select"
                                    value={selectedPeriod}
                                    onChange={(e) => setSelectedPeriod(e.target.value as '90d' | '1y' | 'all')}
                                >
                                    <option value="90d">{t('stats.period_90d')}</option>
                                    <option value="1y">{t('stats.period_1y')}</option>
                                    <option value="all">{t('stats.period_all')}</option>
                                </select>
                            </div>
                            <div className="stats-grid">
                                {/* Views */}
                                <button
                                    type="button"
                                    onClick={() => setExpandedStat(expandedStat === 'views' ? null : 'views')}
                                    className={`stats-tile ${stats.profileViews[selectedPeriod] > 0 ? 'stats-tile--purple' : 'stats-tile--muted'}`}
                                >
                                    <div className="stats-tile-icon">
                                        <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M1 8s2.545-5 7-5 7 5 7 5-2.545 5-7 5-7-5-7-5Z" />
                                            <circle cx="8" cy="8" r="2" />
                                        </svg>
                                    </div>
                                    <div className="stats-tile-content">
                                        <div className="stats-tile-value">
                                            {stats.profileViews[selectedPeriod]}
                                            <span className="stats-tile-info">i</span>
                                        </div>
                                        <div className="stats-tile-label">
                                            {t('stats.views') || 'Views'}
                                        </div>
                                        <div className={`stats-tile-desc ${expandedStat === 'views' ? 'stats-tile-desc--open' : ''}`}>
                                            <div className="stats-tile-desc-text">{t('stats.views_desc') || 'How many times this profile was opened'}</div>
                                        </div>
                                    </div>
                                </button>
                                {/* Requests */}
                                <button
                                    type="button"
                                    onClick={() => setExpandedStat(expandedStat === 'requests' ? null : 'requests')}
                                    className={`stats-tile ${requestCountForPeriod > 0 ? 'stats-tile--orange' : 'stats-tile--muted'}`}
                                >
                                    <div className="stats-tile-icon">
                                        <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                                            <rect x="3" y="1" width="10" height="14" rx="1.5" />
                                            <path d="M6 5h4M6 8h4M6 11h2" strokeLinecap="round" />
                                        </svg>
                                    </div>
                                    <div className="stats-tile-content">
                                        <div className="stats-tile-value">
                                            {requestCountForPeriod}
                                            <span className="stats-tile-info">i</span>
                                        </div>
                                        <div className="stats-tile-label">
                                            {t('stats.requests') || 'Requests'}
                                        </div>
                                        <div className={`stats-tile-desc ${expandedStat === 'requests' ? 'stats-tile-desc--open' : ''}`}>
                                            <div className="stats-tile-desc-text">{t('stats.requests_desc') || 'Adoption requests recorded'}</div>
                                        </div>
                                    </div>
                                </button>
                                {/* Adoptions */}
                                <button
                                    type="button"
                                    onClick={() => setExpandedStat(expandedStat === 'adoptions' ? null : 'adoptions')}
                                    className={`stats-tile ${adoptionCountForPeriod > 0 ? 'stats-tile--green' : 'stats-tile--muted'}`}
                                >
                                    <div className="stats-tile-icon">
                                        <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M2.5 8.5L8 3l5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
                                            <path d="M3.5 7.5V13a1 1 0 001 1h7a1 1 0 001-1V7.5" />
                                        </svg>
                                    </div>
                                    <div className="stats-tile-content">
                                        <div className="stats-tile-value">
                                            {adoptionCountForPeriod}
                                            <span className="stats-tile-info">i</span>
                                        </div>
                                        <div className="stats-tile-label">
                                            {t('stats.adoptions') || 'Adoptions'}
                                        </div>
                                        <div className={`stats-tile-desc ${expandedStat === 'adoptions' ? 'stats-tile-desc--open' : ''}`}>
                                            <div className="stats-tile-desc-text">{t('stats.adoptions_desc') || 'Completed adoptions recorded'}</div>
                                        </div>
                                    </div>
                                </button>
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

                {/* Forms completed by this adopter */}
                {!isNew && (
                    <CollapsibleSection title={t('adopter.forms_section')} count={linkedForms.length} defaultOpen={linkedForms.length > 0}>
                        <div className="space-y-2">
                            {linkedForms.length > 0 ? (
                                linkedForms.map(form => {
                                    const date = form.createdAt ? new Date(form.createdAt).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
                                    const speciesLabel = form.species === 'dog' ? 'Perro' : form.species === 'cat' ? 'Gato' : form.species || '—';
                                    const ageLabel = form.lifeStage === 'puppy' ? 'Cachorro' : form.lifeStage === 'young' ? 'Joven' : form.lifeStage === 'senior' ? 'Senior' : '';
                                    const summary = [speciesLabel, ageLabel].filter(Boolean).join(' · ');
                                    const content = (
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="text-sm font-semibold text-stone-800">
                                                    {date}
                                                </p>
                                                {summary && (
                                                    <p className="text-xs text-stone-500 mt-0.5">
                                                        {t('adopter.form_looking_for')}: {summary}
                                                    </p>
                                                )}
                                            </div>
                                            {form.notificationId && (
                                                <span className="text-xs text-teal-600 font-medium group-hover:underline">
                                                    {t('adopter.form_view_responses')}
                                                </span>
                                            )}
                                        </div>
                                    );
                                    return form.notificationId ? (
                                        <a
                                            key={form.id}
                                            href={`/form-results/${form.notificationId}`}
                                            className="block bg-white border border-stone-200 rounded-xl p-3 hover:border-teal-300 hover:shadow-sm transition-all group"
                                        >
                                            {content}
                                        </a>
                                    ) : (
                                        <div key={form.id} className="block bg-white border border-stone-200 rounded-xl p-3 text-stone-600">
                                            {content}
                                        </div>
                                    );
                                })
                            ) : (
                                <p className="text-sm text-stone-500 py-2">
                                    {t('adopter.forms_empty')}
                                </p>
                            )}
                        </div>
                    </CollapsibleSection>
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
