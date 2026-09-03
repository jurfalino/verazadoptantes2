'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { findAdopters, findWeakNameMatches } from '@/app/actions';
import type { DiscoveryMatch } from '@/app/actions';
import { AdopterResultCard } from './AdopterResultCard';
import { useWalkthrough } from './walkthrough/WalkthroughProvider';
import { useLanguage } from '@/context/LanguageContext';
import { useSession } from 'next-auth/react';
import { useAuthContext } from '@/context/AuthContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { useShowToast } from '@/components/ui/Toast';
import { notifyRequestError } from '@/lib/notifyError';
import { zarazTrack } from '@/lib/zaraz';
import WhatIsBuenAdoptante from '@/components/WhatIsBuenAdoptante';
import { appendCreatePrefill } from '@/lib/createPrefill';

export default function SearchSection({ locale, showCardMetadata = true }: { locale?: string; showCardMetadata?: boolean }) {
    const { t } = useLanguage();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { data: session } = useSession();
    const { openLogin } = useAuthContext();
    const toast = useShowToast();
    // Guided walkthrough: while it runs, this section renders the demo query +
    // results (the spotlight tour highlights these real elements). The tour
    // reveals progressively — empty box → "Juan" → results.
    const { demoActive, demoQuery, demoResults } = useWalkthrough();

    // Initialize from URL params for back-navigation persistence
    const initialQuery = searchParams.get('q') || '';
    const [query, setQuery] = useState(initialQuery);
    const [results, setResults] = useState<DiscoveryMatch[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [truncatedInfo, setTruncatedInfo] = useState<{ truncated: boolean; totalCount: number } | null>(null);
    const [validationError, setValidationError] = useState<string | null>(null);
    const [singleTokenResultCount, setSingleTokenResultCount] = useState<number | undefined>(undefined);
    const resultsRef = useRef<HTMLDivElement>(null);
    // Lazy "weak tier" — fuzzy/partial name matches, loaded only when the user
    // expands "Otras posibles coincidencias" (the duplicate engine's ~3s cost is
    // paid on demand, not on every search). `weakFor` caches which query the
    // results belong to so a re-expand doesn't re-fetch.
    const [weakResults, setWeakResults] = useState<DiscoveryMatch[] | null>(null);
    const [weakLoading, setWeakLoading] = useState(false);
    const weakForRef = useRef<string | null>(null);
    // Partial-coverage matches the backend demoted from the main list (e.g.
    // "maipu 888" for a "maipu 1955" search). Eager — arrives with the response —
    // and shown inside the same "Otras posibles coincidencias" section as the
    // (lazy) fuzzy name matches.
    const [lowRelevanceResults, setLowRelevanceResults] = useState<DiscoveryMatch[]>([]);

    const resetWeak = useCallback(() => {
        setWeakResults(null);
        setWeakLoading(false);
        setLowRelevanceResults([]);
        weakForRef.current = null;
    }, []);

    // Fired on weak-section expand. Loads once per query; the strong-tier ids are
    // excluded so the weak list only holds what the eager search didn't already show.
    const loadWeakMatches = useCallback(async (q: string, strongIds: string[]) => {
        const key = q.trim();
        if (!key || weakForRef.current === key) return;
        weakForRef.current = key;
        setWeakLoading(true);
        try {
            const res = await findWeakNameMatches(key, strongIds);
            setWeakResults((res?.results as DiscoveryMatch[]) ?? []);
        } catch (err) {
            console.error(err);
            weakForRef.current = null; // allow retry on next expand
            setWeakResults([]);
        } finally {
            setWeakLoading(false);
        }
    }, []);

    // Re-run search when returning to page with query in URL
    const runSearch = useCallback(async (searchQuery: string) => {
        if (!searchQuery.trim()) return;
        setLoading(true);
        setValidationError(null);
        setTruncatedInfo(null);
        setSingleTokenResultCount(undefined);
        resetWeak();
        try {
            const response = await findAdopters(
                { raw: searchQuery },
                { mode: 'discovery', enrich: true },
            );
            if (!response) return;
            if (response.validationError) {
                setValidationError(response.validationError);
                setResults([]);
            } else {
                setResults(response.results as DiscoveryMatch[]);
                setLowRelevanceResults((response.lowRelevanceResults as DiscoveryMatch[]) ?? []);
                setSingleTokenResultCount(response.singleTokenResultCount);
                if (response.truncated && response.totalCount) {
                    setTruncatedInfo({ truncated: true, totalCount: response.totalCount });
                }
                // Auto-scroll to results on mobile
                setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
            }
        } catch (err) {
            console.error(err);
            await notifyRequestError(toast.error, t, err, {
                title: t('toast.search_failed_title'),
                message: t('errors.search_failed'),
            });
        } finally {
            setLoading(false);
        }
        // t / toast / resetWeak are stable for this page; runSearch is a one-shot
        // ?q= replay, intentionally not re-created on their identity.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        // Only auto-run when arriving with ?q=… and no results yet AND no in-flight search.
        // The `!loading` guard prevents a double-fire when handleSearch updates the URL via
        // history.replaceState — that URL change re-triggers useSearchParams and would
        // otherwise fire a second findAdopters call (one audit row per call → duplicates
        // in /admin/audit). v2.12.1-35.
        if (initialQuery && !results && !loading) {
            runSearch(initialQuery);
        }
    }, [initialQuery, results, runSearch, loading]);

    // Guided-walkthrough injection: while the tour runs, this section shows the
    // demo "Juan" search; when it ends it restores whatever the user had before
    // (non-destructive — starting the tour mid-search no longer wipes that
    // search). `demoWasActive` gates the restore so it never runs on mount.
    const demoWasActive = useRef(false);
    const preDemoSearch = useRef<{ query: string; results: DiscoveryMatch[] | null } | null>(null);
    useEffect(() => {
        if (demoActive) {
            if (!demoWasActive.current) {
                // Entering the tour — snapshot the user's current search to restore on exit.
                demoWasActive.current = true;
                preDemoSearch.current = { query, results };
            }
            setQuery(demoQuery);
            setResults(demoResults);
            setValidationError(null);
            setTruncatedInfo(null);
            setSingleTokenResultCount(undefined);
        } else if (demoWasActive.current) {
            // Leaving the tour (finished OR closed) — restore the pre-demo search
            // (empty if there was none), so the injected "Juan …" query never
            // lingers AND a real search the user had isn't lost.
            demoWasActive.current = false;
            const pre = preDemoSearch.current;
            preDemoSearch.current = null;
            setQuery(pre?.query ?? '');
            setResults(pre?.results ?? null);
            setValidationError(null);
            setTruncatedInfo(null);
            setSingleTokenResultCount(undefined);
        }
        // query/results are read only to snapshot on entry; outside enter/exit
        // this effect is a no-op, so including them can't clobber a real search.
    }, [demoActive, demoQuery, demoResults, query, results]);

    const handleCreateNew = (e: React.MouseEvent) => {
        e.preventDefault();

        // The query may be a name, a phone, an address or a mix — the search box
        // invites all three. `appendCreatePrefill` classifies it and seeds each
        // part into the right field. Before v2.50.1 anything that was not a phone
        // was written into `name`, so searching an address created an adopter
        // named after a street.
        const params = new URLSearchParams();
        appendCreatePrefill(params, query);
        const queryString = params.toString();
        const createUrl = `/adopter/create${queryString ? `?${queryString}` : ''}`;
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

        setLoading(true);
        setValidationError(null);
        setTruncatedInfo(null);
        resetWeak();
        try {
            const response = await findAdopters(
                { raw: query },
                { mode: 'discovery', enrich: true },
            );
            if (!response) throw new Error('No response from search');
            if (response.validationError) {
                setValidationError(response.validationError);
                setResults([]);
            } else {
                setResults(response.results as DiscoveryMatch[]);
                setLowRelevanceResults((response.lowRelevanceResults as DiscoveryMatch[]) ?? []);
                setSingleTokenResultCount(response.singleTokenResultCount);
                if (response.truncated && response.totalCount) {
                    setTruncatedInfo({ truncated: true, totalCount: response.totalCount });
                }
                // Update URL with query for back-navigation. Done AFTER setResults so that
                // useSearchParams' re-trigger sees results !== null and the auto-run effect
                // skips. v2.12.1-35.
                const url = new URL(window.location.href);
                url.searchParams.set('q', query.trim());
                window.history.replaceState({}, '', url.toString());
                // Track search event in Amplitude via Zaraz
                {
                    const resultCount = (response.results || []).length;
                    zarazTrack('search_performed', {
                        resultCount,
                        // hasResults = 1 when the search surfaced anything; lets
                        // Amplitude funnels filter the "found a match" path
                        // (→ visit_intent_shown → adoption_created) vs the
                        // "no match" path (→ adopter_created → adoption_created).
                        hasResults: resultCount > 0 ? 1 : 0,
                        query_length: query.trim().length,
                        truncated: response.truncated ? 1 : 0,
                    });
                }
                // Auto-scroll to results on mobile
                setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
            }
        } catch (err) {
            await notifyRequestError(toast.error, t, err, {
                title: t('toast.search_failed_title'),
                message: t('errors.search_failed'),
            });
        } finally {
            setLoading(false);
        }
    };

    const handleClear = () => {
        setQuery('');
        setResults(null);
        setValidationError(null);
        setTruncatedInfo(null);
        setSingleTokenResultCount(undefined);
        // Clear URL param
        const url = new URL(window.location.href);
        url.searchParams.delete('q');
        window.history.replaceState({}, '', url.toString());
    };

    // On mobile, make search form sticky when results are visible
    const hasResults = results !== null;

    return (
        <div className="w-full">
            {/* Hero explainer — click-to-expand "¿Qué es Buen Adoptante?".
                Replaces the old utility subtitle ("Busca adoptantes y Registra adopciones").
                Collapses on mobile when results are visible (same pattern as before). */}
            <div className={`mb-4 ${hasResults ? 'hidden md:block' : ''}`}>
                <WhatIsBuenAdoptante />
            </div>

            {/* Search card — just the search tool */}
            <div className={`bg-white rounded-3xl p-5 md:p-6 shadow-sm border border-stone-200 transition-all ${hasResults && !demoActive ? 'md:static sticky top-16 z-30 rounded-b-xl md:rounded-3xl shadow-md md:shadow-sm' : ''
                }`}>
                <form onSubmit={handleSearch} className={hasResults ? 'flex gap-2 items-stretch md:block md:space-y-4' : 'space-y-3'}>
                    <div className="relative flex-1 min-w-0">
                        <label htmlFor="search" className="sr-only">{t('common.search')}</label>
                        {/* text-base (16px) in EVERY state: below 16px, iOS Safari auto-
                            zooms on focus, which was making the field impossible to type
                            in on mobile after a search. */}
                        <input
                            type="text"
                            id="search"
                            placeholder={t('search.placeholder')}
                            className={`w-full border border-stone-200 focus:border-teal-400 focus:ring-4 focus:ring-teal-100 transition-all outline-none text-stone-900 placeholder:text-stone-500 font-medium bg-stone-50 text-base ${hasResults
                                ? 'px-4 py-3 pr-10 rounded-xl md:px-5 md:py-4 md:pr-12 md:rounded-2xl'
                                : 'px-4 py-3.5 pr-12 rounded-2xl'
                                }`}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                        />
                        {query && (
                            <button
                                type="button"
                                onClick={handleClear}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-500 hover:text-stone-600 transition-colors p-1"
                                aria-label={t('search.clear')}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="18" y1="6" x2="6" y2="18"></line>
                                    <line x1="6" y1="6" x2="18" y2="18"></line>
                                </svg>
                            </button>
                        )}
                    </div>
                    {/* After results, mobile uses a compact magnifier so the input stays
                        wide (the long labeled button used to squeeze it to a strip);
                        desktop and the initial state keep the full labeled button. */}
                    <button
                        type="submit"
                        disabled={loading}
                        aria-label={hasResults ? t('search.button') : undefined}
                        className={`bg-teal-200 text-teal-900 font-semibold shadow-sm hover:bg-teal-300 hover:shadow-md transition-all disabled:opacity-70 transform active:scale-[0.98] flex items-center justify-center ${hasResults
                            ? 'flex-none w-12 rounded-xl md:w-full md:py-4 md:px-6 md:rounded-2xl md:text-lg'
                            : 'w-full py-3.5 px-6 rounded-2xl text-base'
                            }`}
                    >
                        {hasResults ? (
                            <>
                                <span className="md:hidden" aria-hidden="true">
                                    {loading ? (
                                        <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" /><path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
                                    ) : (
                                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" strokeLinecap="round" /></svg>
                                    )}
                                </span>
                                <span className="hidden md:inline">{loading ? t('search.searching') : t('search.button')}</span>
                            </>
                        ) : (loading ? t('search.searching') : t('search.button'))}
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
            {validationError === 'login_required' && (
                <div className="mt-4 p-4 bg-teal-50 border border-teal-200 rounded-xl">
                    <p className="text-teal-800 font-medium text-center">
                        🔒 {t('search.login_required')}
                    </p>
                    <div className="mt-3 flex justify-center">
                        <button onClick={(e) => { e.preventDefault(); openLogin(); }} className="px-5 py-2.5 bg-teal-600 text-white rounded-xl font-semibold hover:bg-teal-700 transition-all shadow-sm">
                            {t('nav.sign_in')}
                        </button>
                    </div>
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
                <div ref={resultsRef} data-walkthrough="results" className="mt-8 space-y-4 scroll-mt-4">

                    {/* Refinement Nudge — inside scroll target so mobile auto-scroll doesn't skip it (P1 fix)
                        Amber palette to distinguish from the teal login_required banner (P2 fix) */}
                    {results.length > 0 && singleTokenResultCount !== undefined && (
                        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
                            <span className="text-amber-500 text-lg flex-shrink-0 mt-0.5">🔎</span>
                            <div className="flex-1">
                                <p className="text-amber-800 font-medium text-sm">
                                    {locale === 'en'
                                        ? `${singleTokenResultCount} results found for "${query}". Add a last name, phone, or address to narrow it down.`
                                        : `Se encontraron ${singleTokenResultCount} resultados para "${query}". Agregá un apellido, teléfono o dirección para encontrar a quien buscás.`}
                                </p>
                            </div>
                            <button
                                onClick={() => setSingleTokenResultCount(undefined)}
                                className="text-amber-400 hover:text-amber-600 flex-shrink-0 transition-colors"
                                aria-label={t('nav.close_suggestion')}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                            </button>
                        </div>
                    )}
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


                    {results.map((res) => {
                        const isAuthenticated = !!session?.user;
                        // Carry the search query through to the profile so a
                        // post-signin replay can re-run the match-and-grant
                        // logic for the now-authenticated viewer. Without this
                        // the unmasked reveal seen in the result card vanishes
                        // when the profile opens (no grant got written because
                        // an unauth viewer has no email to attribute one to).
                        const qParam = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
                        const profileHref = `/adopter/${res.adopter.id}${qParam}`;

                        const handleCardClick = (e: React.MouseEvent) => {
                            if (!isAuthenticated) {
                                e.preventDefault();
                                openLogin(profileHref);
                            }
                        };

                        return (
                            <AdopterResultCard
                                key={res.adopter.id}
                                match={res}
                                isAuthenticated={isAuthenticated}
                                showMetadata={showCardMetadata}
                                href={profileHref}
                                onClick={handleCardClick}
                                query={query}
                            />
                        );
                    })}

                    {/* Weak tier — fuzzy / partial / accent-variant name matches, lazy-
                        loaded on expand (the duplicate engine's ~3s cost is paid only here,
                        not on every search). Auto-opens when there are no strong results so
                        a rescuer never concludes "not here" without the recall net. Keyed by
                        query so it remounts (and re-applies defaultOpen) per search. Hidden
                        during the walkthrough and on validation errors. */}
                    {!demoActive && !validationError && query.trim().length >= 2 && (() => {
                        // Combine the eager demoted partial matches (lowRelevanceResults)
                        // with the lazy fuzzy name matches (weakResults), deduped. Fuzzy is
                        // fetched on expand, excluding what's already shown (strong + partials).
                        const strongIds = results.map(r => r.adopter.id);
                        const shownIds = new Set([...strongIds, ...lowRelevanceResults.map(r => r.adopter.id)]);
                        const combined = [
                            ...lowRelevanceResults,
                            ...((weakResults ?? []).filter(r => !shownIds.has(r.adopter.id))),
                        ];
                        const isAuthenticated = !!session?.user;
                        const renderCard = (res: DiscoveryMatch) => {
                            const qParam = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
                            const profileHref = `/adopter/${res.adopter.id}${qParam}`;
                            return (
                                <AdopterResultCard
                                    key={res.adopter.id}
                                    match={res}
                                    isAuthenticated={isAuthenticated}
                                    showMetadata={showCardMetadata}
                                    href={profileHref}
                                    onClick={(e) => { if (!isAuthenticated) { e.preventDefault(); openLogin(profileHref); } }}
                                    query={query}
                                />
                            );
                        };
                        return (
                            // Lightweight, muted disclosure — a secondary "broaden the
                            // search" affordance, deliberately quieter than the result
                            // cards so it doesn't compete with the real matches.
                            <details
                                key={query.trim()}
                                className="group mt-3 border-t border-stone-100 pt-3"
                                open={results.length === 0}
                                onToggle={(e) => { if (e.currentTarget.open) loadWeakMatches(query, [...shownIds]); }}
                            >
                                <summary className="flex flex-wrap items-center gap-x-2 gap-y-0.5 cursor-pointer list-none select-none rounded text-sm text-stone-500 hover:text-stone-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300">
                                    <svg className="w-3.5 h-3.5 flex-shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                    </svg>
                                    <span className="font-medium">{t('search.more_matches_title')}</span>
                                    {combined.length > 0 && (
                                        <span className="text-[11px] font-semibold bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded-full">{combined.length}</span>
                                    )}
                                    <span className="text-xs text-stone-400">{t('search.more_matches_subtitle')}</span>
                                </summary>
                                <div className="mt-3 space-y-3">
                                    {combined.length > 0 && combined.map(renderCard)}
                                    {weakLoading && (
                                        <div className="py-4 flex items-center justify-center gap-2 text-stone-400 text-sm">
                                            <svg className="w-4 h-4 animate-spin motion-reduce:hidden" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
                                                <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                                            </svg>
                                            {t('search.more_matches_loading')}
                                        </div>
                                    )}
                                    {!weakLoading && weakResults !== null && combined.length === 0 && (
                                        <div className="py-4 text-center text-stone-400 text-sm">{t('search.more_matches_empty')}</div>
                                    )}
                                </div>
                            </details>
                        );
                    })()}

                    {/* End-of-results "none match" CTA — appears under the last card so the
                        natural decision moment (user finished reading) has a one-tap exit
                        without scrolling back to the small top-of-list chip. Empty-state
                        below uses a more prominent treatment; this is the secondary path. */}
                    {results.length > 0 && (
                        <div data-walkthrough="create-new" className="bg-stone-50 rounded-2xl p-6 text-center border border-stone-200 mt-4 scroll-mt-28 md:scroll-mt-4">
                            <p className="text-stone-600 mb-1 text-base font-medium">
                                {t('search.none_match_heading')}
                            </p>
                            <p className="text-stone-500 text-sm mb-4">
                                {t('search.none_match_desc')}
                            </p>
                            <button
                                onClick={handleCreateNew}
                                className="inline-block px-5 py-2.5 bg-teal-600 text-white rounded-xl font-semibold hover:bg-teal-700 transition-all shadow-sm"
                            >
                                + {t('search.create_new')}
                            </button>
                        </div>
                    )}
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

