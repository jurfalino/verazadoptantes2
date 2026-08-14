'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useLanguage } from '@/context/LanguageContext';
import { findAdopters } from '@/app/actions';
import type { DiscoveryMatch, SnippetField } from '@/app/actions';
import { RatingBadge } from '@/components/RatingBadge';
import { RatingExplainer } from '@/components/RatingExplainer';
import { AdopterName } from '@/components/AdopterName';

const SEARCH_DEBOUNCE_MS = 250;

const SNIPPET_ICONS: Record<SnippetField, string> = {
    name: '👤', contact: '📞', address: '📍',
    family: '👨‍👩‍👧', adoption: '🐾', history: '📝',
};

type Accent = 'teal' | 'rose';

const ACCENT: Record<Accent, { snippet: string; resultRowSelectedBg: string }> = {
    teal: { snippet: 'text-teal-700', resultRowSelectedBg: 'bg-teal-50 border-l-2 border-l-teal-500' },
    rose: { snippet: 'text-rose-600', resultRowSelectedBg: 'bg-rose-50 border-l-2 border-l-rose-500' },
};

/**
 * AdopterPicker — shared find-or-create widget.
 *
 * Used by the homepage entry-point cards to locate an existing adopter
 * (or hand off to /adopter/create) before transferring control to
 * `AdoptionFormWizard`. Previously the same UI lived duplicated inside
 * `AdoptionWizard` and `ReportWizard`; this is the single source of truth.
 */
export default function AdopterPicker({
    onSelect,
    onCreateNew,
    accent = 'teal',
}: {
    /** Called when the user picks an existing adopter. */
    onSelect: (adopter: DiscoveryMatch) => void;
    /** Called when the user chooses "+ create new". `searchText` is whatever they typed (may be empty). */
    onCreateNew: (searchText: string) => void;
    accent?: Accent;
}) {
    const { t } = useLanguage();
    const { data: session } = useSession();
    const viewerEmail = session?.user?.email ?? null;
    const accentClasses = ACCENT[accent];

    const [search, setSearch] = useState('');
    const [results, setResults] = useState<DiscoveryMatch[]>([]);
    const [searchPerformed, setSearchPerformed] = useState(false);
    const [searching, setSearching] = useState(false);
    const [preview, setPreview] = useState<DiscoveryMatch | null>(null);

    // v2.19.1 race fix. Two independent leaks pre-fix:
    //   1. No debounce ⇒ every keystroke fired a request. Typing "Maria"
    //      dispatched 5 concurrent searches.
    //   2. No request sequencing ⇒ whichever response *resolved* last won,
    //      not the most recent one *dispatched*. So a slow "M" response could
    //      overwrite the correct "Maria" results half a second after the user
    //      stopped typing — exactly the "results change without me touching
    //      anything" symptom reported.
    // Fix: debounce input + monotonic seq counter; drop stale responses by
    // comparing each fulfilled response's seq against the current request seq.
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const requestSeqRef = useRef(0);

    useEffect(() => {
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, []);

    const runSearch = (term: string) => {
        const trimmed = term.trim();
        if (trimmed.length <= 2) {
            // Below the LIKE-min-length threshold the existing UI showed
            // "Start typing…"; preserve that behavior.
            requestSeqRef.current++;  // invalidate any in-flight response
            setResults([]);
            setSearchPerformed(false);
            setSearching(false);
            return;
        }
        const mySeq = ++requestSeqRef.current;
        setSearching(true);
        findAdopters({ raw: trimmed }, { mode: 'discovery', enrich: true })
            .then(response => {
                // Stale-response guard: only commit if this is still the
                // latest request. A request fired later will have bumped
                // requestSeqRef past mySeq.
                if (mySeq !== requestSeqRef.current) return;
                setResults(response.results as DiscoveryMatch[]);
                setSearchPerformed(true);
            })
            .catch(() => {
                if (mySeq !== requestSeqRef.current) return;
                setResults([]);
                setSearchPerformed(true);
            })
            .finally(() => {
                if (mySeq !== requestSeqRef.current) return;
                setSearching(false);
            });
    };

    const handleSearch = (term: string) => {
        setSearch(term);
        setPreview(null);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => runSearch(term), SEARCH_DEBOUNCE_MS);
    };

    if (preview) {
        return (
            <div className="animate-in slide-in-from-right duration-200">
                <div className="border border-teal-200 rounded-xl overflow-hidden bg-teal-50">
                    <div className="p-4 border-b border-teal-100 flex items-center gap-3">
                        {preview.thumbnail ? (
                            <img src={preview.thumbnail} alt="" className="w-12 h-12 rounded-full object-cover border-2 border-white shadow-sm" />
                        ) : (
                            <div className="w-12 h-12 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 font-semibold text-lg">
                                {preview.adopter.name?.charAt(0)?.toUpperCase() || '?'}
                            </div>
                        )}
                        <div className="flex-1 min-w-0">
                            <AdopterName adopter={preview.adopter} className="font-semibold text-stone-800 text-lg line-clamp-2 break-words block" title />
                            {preview.matchSnippet && (
                                <div className={`text-xs ${accentClasses.snippet}`}>{SNIPPET_ICONS[preview.matchSnippet.field as SnippetField]} {t(`search.snippet_${preview.matchSnippet.field}`)}</div>
                            )}
                        </div>
                    </div>

                    <div className="p-4 space-y-3">
                        {preview.adopter.contactInfo && (
                            <div>
                                <div className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1">{t('adopter.contact') || 'Contact'}</div>
                                <div className="text-sm text-stone-700 whitespace-pre-line line-clamp-3">{preview.adopter.contactInfo}</div>
                            </div>
                        )}
                        <div className="flex gap-4 text-sm">
                            {preview.avgRating != null && (
                                <RatingExplainer rating={preview.avgRating}>
                                    <RatingBadge rating={preview.avgRating} variant="inline" size="sm" label="search" />
                                </RatingExplainer>
                            )}
                            {preview.stats?.adoptions != null && (
                                <div className="text-stone-500">
                                    {preview.stats.adoptions} {t('wizard.adoptions_label') || 'adoptions'}
                                </div>
                            )}
                        </div>
                        {preview.adopter.familyMembers && (
                            <div>
                                <div className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1">{t('adopter.family_members') || 'Family'}</div>
                                <div className="text-sm text-stone-600 line-clamp-2">{preview.adopter.familyMembers}</div>
                            </div>
                        )}
                    </div>

                    <div className="p-4 border-t border-teal-100 flex justify-between">
                        <button
                            onClick={() => setPreview(null)}
                            className="text-stone-500 text-sm font-semibold hover:text-stone-800 transition-colors"
                        >
                            {t('wizard.back_to_results') || '← Back to results'}
                        </button>
                        <button
                            onClick={() => onSelect(preview)}
                            className="px-5 py-2 bg-teal-600 text-white font-semibold rounded-xl hover:bg-teal-700 transition-colors text-sm"
                        >
                            ✓ {t('wizard.select_this') || 'Select this person'}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-5">
            <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-stone-500">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                </div>
                <input
                    autoFocus
                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-stone-300 focus:border-teal-400 focus:ring-2 focus:ring-teal-100 transition-all text-stone-800"
                    placeholder={t('wizard.search_name_placeholder') || "Type adopter's name..."}
                    value={search}
                    onChange={e => handleSearch(e.target.value)}
                />
            </div>

            {!searchPerformed && !searching && (
                <div className="text-center py-6 text-stone-500 text-sm">
                    <svg className="w-8 h-8 mx-auto mb-2 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                    {t('wizard.type_to_search') || 'Start typing to search existing adopters'}
                </div>
            )}

            {searching && (
                <div className="text-center py-3 text-stone-500 text-xs italic">
                    {t('common.searching') || 'Buscando...'}
                </div>
            )}

            {searchPerformed && results.length > 0 && (
                <div className="max-h-72 overflow-y-auto border border-stone-200 rounded-xl divide-y">
                    {results.map(res => {
                        const isMine = !!viewerEmail && res.adopter.addedBy === viewerEmail;
                        return (
                        <div
                            key={res.adopter.id}
                            className={`flex items-center gap-3 p-3 hover:bg-teal-50 transition-colors ${isMine ? 'bg-teal-50/50' : ''}`}
                        >
                            {res.thumbnail ? (
                                <img src={res.thumbnail} alt="" className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
                            ) : (
                                <div className="w-9 h-9 rounded-full bg-stone-100 flex items-center justify-center text-stone-500 font-semibold text-sm flex-shrink-0">
                                    {res.adopter.name?.charAt(0)?.toUpperCase() || '?'}
                                </div>
                            )}

                            <button
                                onClick={() => onSelect(res)}
                                className="flex-1 text-left min-w-0"
                            >
                                <div className="flex items-center gap-2">
                                    <AdopterName adopter={res.adopter} className="font-semibold text-sm text-stone-800 truncate" title />
                                    {/* v2.19.1: visible "yours" cue so the rescuer
                                        can spot their own records in a mixed list. */}
                                    {isMine && (
                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-teal-100 text-teal-700 flex-shrink-0">
                                            {t('wizard.your_record') || 'Tuyo'}
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 text-xs text-stone-500">
                                    {res.avgRating != null && (
                                        <RatingBadge rating={res.avgRating} variant="inline" size="sm" label="short" />
                                    )}
                                    {res.stats?.adoptions > 0 && (
                                        <span>{res.stats.adoptions} {t('wizard.adoptions_label') || 'adoptions'}</span>
                                    )}
                                    {res.matchSnippet && <span className={accentClasses.snippet}>· {SNIPPET_ICONS[res.matchSnippet.field as SnippetField]} {t(`search.snippet_${res.matchSnippet.field}`)}</span>}
                                </div>
                            </button>

                            <button
                                onClick={() => setPreview(res)}
                                className="p-2 text-stone-500 hover:text-teal-700 hover:bg-teal-50 rounded-lg transition-colors flex-shrink-0"
                                title={t('wizard.preview') || 'Preview'}
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                            </button>
                        </div>
                        );
                    })}
                </div>
            )}

            {searchPerformed && results.length === 0 && (
                <div className="text-center py-4 text-stone-500 text-sm">
                    {t('wizard.no_results_for') || 'No records found for'} &quot;{search}&quot;
                </div>
            )}

            <button
                onClick={() => onCreateNew(search.trim())}
                className="w-full p-3 border-2 border-dashed border-stone-300 rounded-xl text-stone-600 hover:border-teal-400 hover:text-teal-700 hover:bg-teal-50 transition-all text-sm font-semibold text-center"
            >
                {search.trim()
                    ? `${t('wizard.create_new_named') || '+ Create new record for'} "${search.trim()}"`
                    : (t('wizard.create_new_record') || '+ Create new adopter record')
                }
            </button>
        </div>
    );
}
