'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { searchAdopter, SearchResult } from '@/app/actions';
import { RatingBadge } from './RatingBadge';
import { useLanguage } from '@/context/LanguageContext';
import { useSession } from 'next-auth/react';
import { useAuthContext } from '@/context/AuthContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { useShowToast } from '@/components/ui/Toast';
import { extractErrorId } from '@/lib/errorUtils';
import { formatShortDate } from '@/lib/dates';
import { zarazTrack } from '@/lib/zaraz';
import { ShieldPawIcon } from '@/components/Logo';
import Link from 'next/link';

export default function SearchSection({ locale }: { locale?: string }) {
    const { t } = useLanguage();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { data: session } = useSession();
    const { openLogin } = useAuthContext();
    const toast = useShowToast();

    // Initialize from URL params for back-navigation persistence
    const initialQuery = searchParams.get('q') || '';
    const [query, setQuery] = useState(initialQuery);
    const [results, setResults] = useState<SearchResult[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [truncatedInfo, setTruncatedInfo] = useState<{ truncated: boolean; totalCount: number } | null>(null);
    const [validationError, setValidationError] = useState<string | null>(null);
    const [showLegend, setShowLegend] = useState(false);
    const resultsRef = useRef<HTMLDivElement>(null);

    // Re-run search when returning to page with query in URL
    const runSearch = useCallback(async (searchQuery: string) => {
        if (!searchQuery.trim()) return;
        setLoading(true);
        setValidationError(null);
        setTruncatedInfo(null);
        try {
            const response = await searchAdopter(searchQuery);
            if (!response) return;
            if (response.validationError) {
                setValidationError(response.validationError);
                setResults([]);
            } else {
                setResults(response.results || []);
                if (response.truncated && response.totalCount) {
                    setTruncatedInfo({ truncated: true, totalCount: response.totalCount });
                }
                // Auto-scroll to results on mobile
                setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
            }
        } catch (err) {
            console.error(err);
            toast.error('Search Failed', 'An error occurred while searching. Please try again.', extractErrorId(err));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (initialQuery && !results) {
            runSearch(initialQuery);
        }
    }, [initialQuery, results, runSearch]);

    const handleCreateNew = (e: React.MouseEvent) => {
        e.preventDefault();
        const nameParam = query.trim() ? `?name=${encodeURIComponent(query.trim())}` : '';
        const createUrl = `/adopter/create${nameParam}`;
        if (!session?.user) {
            openLogin(createUrl);
        } else {
            try {
                router.push(createUrl);
                // Fallback if router fails
                setTimeout(() => {
                    if (!window.location.pathname.includes('/adopter/')) {
                        window.location.href = createUrl;
                    }
                }, 500);
            } catch (e) {
                window.location.href = createUrl;
            }
        }
    };

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!query.trim()) return;

        // Update URL with query for back-navigation
        const url = new URL(window.location.href);
        url.searchParams.set('q', query.trim());
        window.history.replaceState({}, '', url.toString());

        setLoading(true);
        setValidationError(null);
        setTruncatedInfo(null);
        try {
            const response = await searchAdopter(query);
            if (!response) throw new Error('No response from search');
            if (response.validationError) {
                setValidationError(response.validationError);
                setResults([]);
            } else {
                setResults(response.results || []);
                if (response.truncated && response.totalCount) {
                    setTruncatedInfo({ truncated: true, totalCount: response.totalCount });
                }
                // Track search event in Amplitude via Zaraz
                zarazTrack('search_performed', {
                    resultCount: (response.results || []).length,
                    query_length: query.trim().length,
                    truncated: response.truncated ? 1 : 0,
                });
                // Auto-scroll to results on mobile
                setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
            }
        } catch (err) {
            console.error(err);
            toast.error('Search Failed', 'An error occurred while searching. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const handleClear = () => {
        setQuery('');
        setResults(null);
        setValidationError(null);
        setTruncatedInfo(null);
        // Clear URL param
        const url = new URL(window.location.href);
        url.searchParams.delete('q');
        window.history.replaceState({}, '', url.toString());
    };

    // On mobile, make search form sticky when results are visible
    const hasResults = results !== null;

    return (
        <div className="w-full">
            {/* Hero header — outside the card, hides when results visible */}
            <div className={`text-center mb-5 ${hasResults ? 'hidden md:block' : ''}`}>
                <ShieldPawIcon className="w-10 h-10 mx-auto mb-2" />
                <h1 className="text-3xl font-extrabold text-stone-900 mb-2 tracking-tight">{t('home.title')}</h1>
                <div className="flex flex-col items-center gap-1 mb-3">
                    <p className="text-stone-500 text-sm font-medium flex items-center gap-2">
                        <svg className="w-4 h-4 text-teal-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>
                        {t('home.value_verify')}
                    </p>
                    <p className="text-stone-500 text-sm font-medium flex items-center gap-2">
                        <svg className="w-4 h-4 text-teal-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
                        {t('home.value_register')}
                    </p>
                </div>
                <div className="flex items-center justify-center gap-2 flex-wrap">
                    <Link href={locale === 'en' ? '/guide' : '/guia'} className="hero-pill group">
                        <svg className="w-3.5 h-3.5 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" /></svg>
                        <span>{t('home.hero_guide')}</span>
                        <svg className="w-3 h-3 opacity-40 group-hover:opacity-70 group-hover:translate-x-0.5 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
                    </Link>
                    <Link href="/funcionalidades" className="hero-pill group">
                        <svg className="w-3.5 h-3.5 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" /></svg>
                        <span>{t('home.hero_features')}</span>
                        <svg className="w-3 h-3 opacity-40 group-hover:opacity-70 group-hover:translate-x-0.5 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
                    </Link>
                </div>
            </div>

            {/* Search card — just the search tool */}
            <div className={`bg-white rounded-3xl p-5 md:p-6 shadow-sm border border-stone-200 transition-all ${hasResults ? 'md:static sticky top-16 z-30 rounded-b-xl md:rounded-3xl shadow-md md:shadow-sm' : ''
                }`}>
                <form onSubmit={handleSearch} className={hasResults ? 'flex gap-2 items-center md:block md:space-y-4' : 'space-y-3'}>
                    <div className="relative flex-1">
                        <label htmlFor="search" className="sr-only">{t('common.search')}</label>
                        <input
                            type="text"
                            id="search"
                            placeholder={t('search.placeholder')}
                            className={`w-full border border-stone-200 focus:border-teal-400 focus:ring-4 focus:ring-teal-100 transition-all outline-none text-stone-900 placeholder:text-stone-500 font-medium bg-stone-50 ${hasResults
                                ? 'px-4 py-3 pr-10 rounded-xl text-sm md:px-5 md:py-4 md:pr-12 md:rounded-2xl md:text-base'
                                : 'px-4 py-3.5 pr-12 rounded-2xl'
                                }`}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                        />
                        {query && (
                            <button
                                type="button"
                                onClick={handleClear}
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-stone-500 hover:text-stone-600 transition-colors p-1"
                                aria-label={t('search.clear')}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="18" y1="6" x2="6" y2="18"></line>
                                    <line x1="6" y1="6" x2="18" y2="18"></line>
                                </svg>
                            </button>
                        )}
                    </div>
                    <button
                        type="submit"
                        disabled={loading}
                        className={`bg-teal-200 text-teal-900 font-semibold shadow-sm hover:bg-teal-300 hover:shadow-md transition-all disabled:opacity-70 transform active:scale-[0.98] ${hasResults
                            ? 'px-4 py-3 rounded-xl text-sm md:w-full md:py-4 md:px-6 md:rounded-2xl md:text-lg'
                            : 'w-full py-3.5 px-6 rounded-2xl text-base'
                            }`}
                    >
                        {loading ? t('search.searching') : t('search.button')}
                    </button>
                </form>

                {!results && !loading && !query && (
                    <p className="text-center text-stone-500 text-xs mt-2">
                        <svg className="w-3.5 h-3.5 inline-block mr-1 -mt-0.5 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" /></svg>
                        {t('search.hint')}
                    </p>
                )}

                <style>{`
                    .hero-pill {
                        display: inline-flex;
                        align-items: center;
                        gap: 0.375rem;
                        padding: 0.5rem 1rem;
                        font-size: 0.8125rem;
                        font-weight: 600;
                        color: var(--text-secondary);
                        background: var(--surface-card);
                        border: 1px solid var(--border-default);
                        border-radius: 0.75rem;
                        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
                        text-decoration: none;
                        will-change: transform, box-shadow;
                        white-space: nowrap;
                    }
                    .hero-pill:hover {
                        transform: translateY(-2px);
                        border-color: var(--border-accent);
                        color: var(--accent);
                        background: var(--accent-subtle-bg);
                        box-shadow: 0 4px 12px -2px rgba(13, 148, 136, 0.15),
                                    0 1px 3px rgba(0, 0, 0, 0.06);
                    }
                    .hero-pill:active {
                        transform: translateY(0);
                        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
                    }
                `}</style>
            </div>

            {/* Validation Error Banner */}
            {validationError === 'min_digits' && (
                <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                    <p className="text-amber-800 font-medium text-center">
                        ⚠️ {t('search.min_digits')}
                    </p>
                </div>
            )}

            {/* Truncation Warning Banner */}
            {truncatedInfo?.truncated && (
                <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                    <p className="text-blue-800 font-medium text-center">
                        ℹ️ {t('search.too_many_results').replace('{count}', truncatedInfo.totalCount.toString())}
                    </p>
                </div>
            )}

            {results && (
                <div ref={resultsRef} className="mt-8 space-y-4 scroll-mt-4">
                    {results.length > 0 && (
                        <div className="flex justify-between items-center px-2">
                            <h3 className="text-lg font-semibold text-stone-800">
                                {t('search.results').replace('{count}', results.length.toString())}
                            </h3>
                            <button
                                onClick={handleCreateNew}
                                className="flex items-center gap-2 px-3 py-1.5 text-sm font-semibold text-teal-700 bg-teal-100 hover:bg-teal-200 rounded-lg transition-colors"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                                {t('search.create_new')}
                            </button>
                        </div>
                    )}

                    {/* Protected info banner for unauthenticated users */}
                    {results.length > 0 && !session?.user && (
                        <div className="bg-teal-50 border border-teal-200 rounded-xl px-4 py-3 text-center">
                            <p className="text-teal-800 text-sm font-medium">
                                🔒 {t('search.protected_info')}
                            </p>
                        </div>
                    )}

                    {/* Flag legend toggle */}
                    {results.length > 0 && (
                        <div className="text-center">
                            <button
                                onClick={() => setShowLegend(!showLegend)}
                                className="text-xs text-stone-500 hover:text-stone-600 transition-colors underline underline-offset-2"
                            >
                                ℹ️ {t('flags.legend_title')}
                            </button>
                            {showLegend && (
                                <div className="mt-2 bg-stone-50 border border-stone-200 rounded-xl p-4 text-left text-xs text-stone-600 space-y-2">
                                    <div className="flex items-start gap-2">
                                        <span className="px-1.5 py-0.5 rounded font-medium bg-teal-100 text-teal-700 flex-shrink-0">✓</span>
                                        <span>{t('flags.legend_verified')}</span>
                                    </div>
                                    <div className="flex items-start gap-2">
                                        <span className="px-1.5 py-0.5 rounded font-medium bg-rose-100 text-rose-700 flex-shrink-0">⚠</span>
                                        <span>{t('flags.legend_warning')}</span>
                                    </div>
                                    <div className="flex items-start gap-2">
                                        <span className="px-1.5 py-0.5 rounded font-medium bg-amber-100 text-amber-700 flex-shrink-0">📄</span>
                                        <span>{t('flags.legend_duplicate')}</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                    {results.map((res) => {
                        // PII masking for unauthenticated users
                        const isAuthenticated = !!session?.user;

                        // Partial name masking: show first 3 chars + ****
                        const maskedName = isAuthenticated
                            ? res.adopter.name
                            : (res.adopter.name?.length > 3
                                ? res.adopter.name.slice(0, 3) + '••••'
                                : '••••');

                        // Partial contact masking: show some context but hide sensitive parts
                        const maskedContact = isAuthenticated
                            ? res.adopter.contactInfo
                            : res.adopter.contactInfo
                                ?.replace(/(\d{2,3})[\d\s\-.()]{4,}/g, '$1••••••')  // Partial phone: show first 2-3 digits, mask rest
                                ?.replace(/[a-zA-Z0-9._%+-]+@/g, '•••@');  // Email: hide username

                        const handleCardClick = (e: React.MouseEvent) => {
                            if (!isAuthenticated) {
                                e.preventDefault();
                                openLogin(`/adopter/${res.adopter.id}`);
                            }
                        };

                        // Format dates
                        const addedDate = res.adopter.createdAt ? formatShortDate(res.adopter.createdAt) : null;
                        const updatedDate = res.adopter.updatedAt ? formatShortDate(res.adopter.updatedAt) : null;

                        return (
                            <a key={res.adopter.id} href={`/adopter/${res.adopter.id}`} onClick={handleCardClick} className="block group">
                                <div className="bg-white rounded-xl p-4 shadow-sm border border-stone-200 group-hover:border-teal-300 group-hover:shadow-md transition-all">
                                    {/* Top Row: Avatar + Name/Contact + Rating */}
                                    <div className="flex items-center gap-3 mb-3">
                                        {/* Thumbnail - larger 48px */}
                                        <div className="w-12 h-12 rounded-full bg-stone-100 flex-shrink-0 overflow-hidden ring-2 ring-white shadow-sm">
                                            {res.thumbnail ? (
                                                <img src={res.thumbnail} alt="" className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-stone-500">
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                                </div>
                                            )}
                                        </div>
                                        {/* Name + Contact */}
                                        <div className="flex-1 min-w-0">
                                            <div className="font-semibold text-stone-900 group-hover:text-teal-700 transition-colors truncate">{maskedName}</div>
                                            <div className="text-xs text-stone-500 truncate">
                                                {maskedContact || t('common.no_contact')}
                                                {!isAuthenticated && maskedContact && (
                                                    <span className="ml-1 text-teal-700 font-medium">• {t('search.login_to_view')}</span>
                                                )}
                                            </div>
                                        </div>
                                        {/* Rating Badge */}
                                        {res.avgRating !== null && (
                                            <RatingBadge rating={String(Math.round(res.avgRating))} size="sm" />
                                        )}
                                    </div>

                                    {/* Stats Row */}
                                    <div className="flex flex-wrap items-center gap-3 text-xs text-stone-500">
                                        <span>👁 {res.stats.profileViews} {t('stats.views')}</span>
                                        <span>📋 {res.stats.requests} {t('stats.requests')}</span>
                                        <span>🏠 {res.stats.adoptions} {t('stats.adoptions')}</span>
                                        {/* Flag indicators */}
                                        <div className="flex flex-wrap gap-1 ml-auto">
                                            {res.flags.inaccurate && (
                                                <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-rose-100 text-rose-700">⚠ {t('flags.inaccurate') || 'Inaccurate'}</span>
                                            )}
                                            {res.flags.duplicate && (
                                                <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-amber-100 text-amber-700">📄 {t('flags.duplicate') || 'Duplicate'}</span>
                                            )}
                                            {res.flags.systemDuplicate && !res.flags.duplicate && (
                                                <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-stone-100 text-stone-500">🔗 {t('flags.possible_duplicate') || 'Possible duplicate'}</span>
                                            )}
                                            {res.flags.verified_identity && (
                                                <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-teal-100 text-teal-700">✓ {t('flags.verified_identity') || 'Verified ID'}</span>
                                            )}
                                            {res.flags.verified_address && (
                                                <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-teal-100 text-teal-700">✓ {t('flags.verified_address') || 'Verified Address'}</span>
                                            )}
                                            {res.flags.tooManyAdoptions && (
                                                <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-orange-100 text-orange-700">⚠ {res.flags.tooManyAdoptions.count} {t('stats.adoptions') || 'adoptions'}/{res.flags.tooManyAdoptions.periodDays}d</span>
                                            )}
                                            {res.flags.tooManyRequests && (
                                                <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-purple-100 text-purple-700">⚠ {res.flags.tooManyRequests.count} {t('stats.requests') || 'requests'}/{res.flags.tooManyRequests.periodDays}d</span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Match Context (if applicable) */}
                                    {res.matchContext && (
                                        <div className="mt-2 text-xs font-medium text-teal-800 bg-teal-50 px-2 py-1 rounded border border-teal-100 inline-block">
                                            🔍 {t(`wizard.${res.matchContext}`) || res.matchContext}
                                        </div>
                                    )}

                                    {/* Dates Row - bottom right */}
                                    <div className="flex justify-end gap-3 mt-2 pt-2 border-t border-stone-100 text-xs text-stone-500">
                                        {addedDate && (
                                            <span>📅 {addedDate}</span>
                                        )}
                                        {updatedDate && (
                                            <span>✏️ {updatedDate}</span>
                                        )}
                                    </div>
                                </div>
                            </a>
                        );
                    })}
                    {results.length === 0 && (
                        <div className="bg-stone-50 rounded-2xl p-8 text-center border border-stone-200">
                            <div className="text-4xl mb-3">🔍</div>
                            <p className="text-stone-600 mb-1 text-lg">{t('search.no_history').replace('{query}', query)}</p>
                            <p className="text-stone-500 text-sm mb-4">{t('search.no_history_cta')}</p>
                            <button onClick={handleCreateNew} className="inline-block px-5 py-2.5 bg-teal-600 text-white rounded-xl font-semibold hover:bg-teal-700 transition-all shadow-sm">
                                + {t('search.create_new')}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

