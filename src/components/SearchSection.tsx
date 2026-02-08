'use client';

import { useState, useEffect, useCallback } from 'react';
import { searchAdopter, SearchResult, SearchResponse } from '@/app/actions';
import { RatingBadge } from './RatingBadge';
import { useLanguage } from '@/context/LanguageContext';
import { useSession } from 'next-auth/react';
import { useAuthContext } from '@/context/AuthContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { useShowToast } from '@/components/ui/Toast';

// Format date as "Feb 4 '26" (3-letter month + day + year)
function formatShortDate(input: Date | number): string {
    const date = input instanceof Date ? input : new Date(input);
    const month = date.toLocaleDateString('en-US', { month: 'short' });
    const day = date.getDate();
    const year = date.getFullYear().toString().slice(-2);
    return `${month} ${day} '${year}`;
}

export default function SearchSection() {
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

    // Re-run search when returning to page with query in URL
    const runSearch = useCallback(async (searchQuery: string) => {
        if (!searchQuery.trim()) return;
        setLoading(true);
        setValidationError(null);
        setTruncatedInfo(null);
        try {
            const response = await searchAdopter(searchQuery);
            if (response.validationError) {
                setValidationError(response.validationError);
                setResults([]);
            } else {
                setResults(response.results);
                if (response.truncated && response.totalCount) {
                    setTruncatedInfo({ truncated: true, totalCount: response.totalCount });
                }
            }
        } catch (err) {
            console.error(err);
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
        // Check both session and anon cookie (anon cookie handling in client is via document.cookie usually, but layout handles session hydration)
        // Since we wrapped SessionProvider, session should be active for anon users if the backend returns it?
        // Actually, our RootLayout manual check `isAuthenticated` doesn't automatically sync with `useSession` if next-auth doesn't know about anon cookie.
        // However, UserMenu uses `isAnon` prop.
        // Let's check if session.user exists. If not, check "anon_user" cookie manually or just use a helper.
        // For simplicity, if !session?.user && !document.cookie.includes('anon_user'), open login.

        const isAnon = document.cookie.includes('anon_user=true');
        if (!session?.user && !isAnon) {
            openLogin('/adopter/create');
        } else {
            try {
                router.push('/adopter/create');
                // Fallback if router fails
                setTimeout(() => {
                    if (!window.location.pathname.includes('/adopter/')) {
                        window.location.href = '/adopter/create';
                    }
                }, 500);
            } catch (e) {
                window.location.href = '/adopter/create';
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
            if (response.validationError) {
                setValidationError(response.validationError);
                setResults([]);
            } else {
                setResults(response.results);
                if (response.truncated && response.totalCount) {
                    setTruncatedInfo({ truncated: true, totalCount: response.totalCount });
                }
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

    return (
        <div className="w-full">
            <div className="bg-white rounded-3xl p-6 shadow-sm border border-stone-200">
                <h2 className="text-2xl font-bold text-stone-900 mb-5 text-center tracking-tight">{t('search.title')}</h2>
                <form onSubmit={handleSearch} className="space-y-4">
                    <div className="relative">
                        <label htmlFor="search" className="sr-only">{t('common.search')}</label>
                        <input
                            type="text"
                            id="search"
                            placeholder={t('search.placeholder')}
                            className="w-full px-5 py-4 pr-12 rounded-2xl bg-stone-50 border border-stone-200 focus:border-teal-400 focus:ring-4 focus:ring-teal-100 transition-all outline-none text-stone-900 placeholder:text-stone-400 font-medium"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                        />
                        {query && (
                            <button
                                type="button"
                                onClick={handleClear}
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 transition-colors p-1"
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
                        className="w-full py-4 px-6 bg-teal-200 text-teal-900 font-bold rounded-2xl shadow-sm hover:bg-teal-300 hover:shadow-md transition-all disabled:opacity-70 transform active:scale-[0.98] text-lg"
                    >
                        {loading ? t('search.searching') : t('search.button')}
                    </button>
                </form>
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
                <div className="mt-8 space-y-4">
                    {results.length > 0 && (
                        <div className="flex justify-between items-center px-2">
                            <h3 className="text-lg font-semibold text-stone-800">
                                {t('search.results').replace('{count}', results.length.toString())}
                            </h3>
                            <button
                                onClick={handleCreateNew}
                                className="flex items-center gap-2 px-3 py-1.5 text-sm font-bold text-teal-800 bg-teal-100 hover:bg-teal-200 rounded-lg transition-colors"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                                {t('search.create_new')}
                            </button>
                        </div>
                    )}
                    {results.map((res) => {
                        // PII masking for unauthenticated users
                        const isAuthenticated = session?.user || document.cookie.includes('anon_user=true');

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
                                                <div className="w-full h-full flex items-center justify-center text-stone-400">
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                                </div>
                                            )}
                                        </div>
                                        {/* Name + Contact */}
                                        <div className="flex-1 min-w-0">
                                            <div className="font-semibold text-stone-900 group-hover:text-teal-700 transition-colors truncate">{maskedName}</div>
                                            <div className="text-xs text-stone-400 truncate">
                                                {maskedContact || t('common.no_contact')}
                                                {!isAuthenticated && maskedContact && (
                                                    <span className="ml-1 text-teal-600 font-medium">• {t('search.login_to_view')}</span>
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
                                        <span>🔍 {res.stats.searchHits} {t('stats.searches')}</span>
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
                                            {res.flags.verified_identity && (
                                                <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-emerald-100 text-emerald-700">✓ Identidad</span>
                                            )}
                                            {res.flags.verified_address && (
                                                <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-emerald-100 text-emerald-700">✓ Direccion</span>
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
                                            🔍 {res.matchContext}
                                        </div>
                                    )}

                                    {/* Dates Row - bottom right */}
                                    <div className="flex justify-end gap-3 mt-2 pt-2 border-t border-stone-100 text-xs text-stone-400">
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
                            <p className="text-stone-600 mb-4 text-lg">{t('search.no_history').replace('{query}', query)}</p>
                            <button onClick={handleCreateNew} className="inline-block px-5 py-2.5 bg-white border border-stone-200 rounded-xl text-stone-800 font-bold hover:border-stone-300 hover:bg-stone-50 transition-all shadow-sm">
                                {t('search.create_new')}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

