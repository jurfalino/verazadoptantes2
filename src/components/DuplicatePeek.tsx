'use client';

/**
 * Peripheral duplicate-match surface for AdopterForm (create mode).
 *
 * - A sticky filled bar across the top of the form ("⚠️ N posibles
 *   coincidencias — Revisar") so the user is never unaware that matches exist.
 * - Click → slide-in side panel (right on desktop, bottom sheet on mobile) with
 *   the same per-row content the legacy inline amber card had — names, contact
 *   snippet, match-reason chips, "Ver perfil", "Continuar con este perfil".
 * - Entry pulse on first appearance; soft single pulse on count change.
 * - "+N" badge when new matches appear while the panel is closed.
 * - Auto-opens panel exactly once on the first STRONG match arrival (phone /
 *   email / social hit), per `feedback_overflow_audit_method` discipline:
 *   identity collisions must not be missable.
 *
 * Themed Tailwind only (per `feedback_themed_colors_only`): amber-50/100/200/300
 * + text-amber-700/800/900 + stone-* shades verified against globals.css.
 */

import { useEffect, useRef, useState } from 'react';
import type { DiscoveryMatch } from '@/app/actions';
import { buildMatchChips, hasStrongMatch, type MatchChip } from '@/lib/matchChips';
import { useLanguage } from '@/context/LanguageContext';

interface Props {
    results: DiscoveryMatch[] | null;
    searching: boolean;
    onContinueWith?: (adopterId: string) => Promise<void> | void;
    /** Distinguishes "user dismissed it" from "no matches" — DuplicatePeek itself
     *  doesn't persist dismissal state; consumers wire if needed. */
    busyAdopterId?: string | null;
}

function MatchChipsRow({ chips }: { chips: MatchChip[] }) {
    if (chips.length === 0) return null;
    return (
        <div className="flex flex-wrap gap-1 mt-1.5">
            {chips.map(chip => (
                <span
                    key={chip.key}
                    className={
                        chip.isStrong
                            ? 'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-100 text-amber-900 border border-amber-200'
                            : 'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-stone-100 text-stone-700 border border-stone-200'
                    }
                    title={chip.label}
                >
                    <span aria-hidden="true">{chip.icon}</span>
                    <span className="truncate max-w-[180px]">{chip.label}</span>
                </span>
            ))}
        </div>
    );
}

export default function DuplicatePeek({ results, searching, onContinueWith, busyAdopterId }: Props) {
    const { t } = useLanguage();
    const [expanded, setExpanded] = useState(false);
    const [pulse, setPulse] = useState(false);
    const prevCountRef = useRef(0);
    const hasAutoOpenedRef = useRef(false);

    const count = results?.length ?? 0;
    const firstResult = results?.[0];
    const firstIsStrong = firstResult ? hasStrongMatch(firstResult.matchValues) : false;

    useEffect(() => {
        const prev = prevCountRef.current;
        if (count > prev) {
            // Pulse on growth — entry (0 → N) gets a stronger pulse via CSS duration.
            // The bar already shows the live count; no separate +N badge needed.
            setPulse(true);
            const id = setTimeout(() => setPulse(false), prev === 0 ? 1600 : 700);
            return () => clearTimeout(id);
        }
        prevCountRef.current = count;
    }, [count]);

    useEffect(() => {
        // Auto-expand exactly once if the FIRST match arriving is strong.
        if (hasAutoOpenedRef.current) return;
        if (count > 0 && firstIsStrong && !expanded) {
            hasAutoOpenedRef.current = true;
            setExpanded(true);
        }
    }, [count, firstIsStrong, expanded]);

    useEffect(() => {
        // Track count *after* we've reacted to it (effect ordering above already read prev).
        prevCountRef.current = count;
    }, [count]);

    // Empty / searching states
    if (!searching && count === 0) return null;

    return (
        <>
            {/* ─── Sticky bar ────────────────────────────────────────────────── */}
            <button
                type="button"
                onClick={() => count > 0 && setExpanded(true)}
                disabled={count === 0}
                aria-label={count === 0 ? (t('adopter.dup_peek_pill_searching') || 'Searching...') : (t('adopter.dup_peek_panel_title') || 'Possible matches')}
                className={[
                    'sticky top-0 z-20 -mx-5 -mt-5 mb-4 w-[calc(100%+2.5rem)]',
                    'flex items-center justify-between gap-3 px-5 py-3',
                    'bg-amber-100 hover:bg-amber-200 text-amber-900 border-b border-amber-300',
                    'transition-colors duration-150',
                    'text-left text-sm font-semibold cursor-pointer disabled:cursor-default',
                    pulse ? 'animate-pulse' : '',
                ].join(' ')}
            >
                <span className="flex items-center gap-2 min-w-0">
                    {searching && count === 0 ? (
                        <>
                            <span className="inline-block w-4 h-4 border-2 border-amber-700 border-t-transparent rounded-full animate-spin" aria-hidden />
                            <span className="truncate">{t('adopter.dup_peek_pill_searching') || 'Searching for matches...'}</span>
                        </>
                    ) : (
                        <>
                            <span aria-hidden>⚠️</span>
                            <span className="truncate">
                                {count === 1
                                    ? (t('adopter.dup_peek_pill_one') || '1 possible match — Review')
                                    : (t('adopter.dup_peek_pill_many') || '{n} possible matches — Review').replace('{n}', String(count))}
                            </span>
                        </>
                    )}
                </span>
                {count > 0 && (
                    <span className="text-xs font-medium text-amber-800 flex-shrink-0">
                        {count === 1
                            ? (t('adopter.dup_action_view') || 'View profile')
                            : (t('adopter.dup_action_view_many') || 'View profiles')} →
                    </span>
                )}
            </button>

            {/* ─── Side panel / bottom sheet ─────────────────────────────────── */}
            {expanded && (
                <div
                    className="fixed inset-0 z-[60]"
                    role="dialog"
                    aria-modal="true"
                    aria-label={t('adopter.dup_peek_panel_title') || 'Possible matches'}
                    onClick={() => setExpanded(false)}
                >
                    <div className="absolute inset-0 bg-stone-900/30 backdrop-blur-sm animate-in fade-in duration-200" />
                    <div
                        className={[
                            'absolute bg-white shadow-2xl border-stone-200 animate-in duration-300 overflow-y-auto',
                            // Mobile: bottom sheet
                            'inset-x-0 bottom-0 max-h-[80vh] rounded-t-2xl border-t slide-in-from-bottom-4',
                            // Desktop: right-side panel
                            'md:left-auto md:top-0 md:bottom-0 md:right-0 md:w-[28rem] md:max-h-none md:rounded-none md:rounded-l-2xl md:border-l md:border-t-0 md:slide-in-from-right-4',
                        ].join(' ')}
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="sticky top-0 bg-white border-b border-stone-200 px-5 py-4 flex items-center justify-between">
                            <div>
                                <h3 className="font-semibold text-stone-900">
                                    {t('adopter.dup_peek_panel_title') || 'Possible matches'}
                                </h3>
                                <p className="text-xs text-stone-500 mt-0.5">
                                    {count} {count === 1 ? 'perfil' : 'perfiles'}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setExpanded(false)}
                                className="w-8 h-8 rounded-full flex items-center justify-center text-stone-500 hover:bg-stone-100"
                                aria-label={t('common.close') || 'Close'}
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <ul className="divide-y divide-stone-100">
                            {(results ?? []).map(result => {
                                const chips = buildMatchChips(result.matchValues, t);
                                const strong = hasStrongMatch(result.matchValues);
                                return (
                                    <li key={result.adopter.id} className={`px-5 py-3 ${strong ? 'bg-amber-50/40' : ''}`}>
                                        <div className="flex items-start gap-3">
                                            {result.thumbnail ? (
                                                <img src={result.thumbnail} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
                                            ) : (
                                                <div className="w-10 h-10 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 font-semibold text-sm flex-shrink-0">
                                                    {result.adopter.name?.charAt(0)?.toUpperCase() || '?'}
                                                </div>
                                            )}
                                            <div className="min-w-0 flex-1">
                                                <p className="font-semibold text-stone-900 text-sm truncate">{result.adopter.name}</p>
                                                {result.adopter.contactInfo && (
                                                    <p className="text-xs text-stone-500 truncate">{result.adopter.contactInfo}</p>
                                                )}
                                                <MatchChipsRow chips={chips} />
                                                <div className="flex gap-2 mt-2.5">
                                                    <a
                                                        href={`/adopter/${result.adopter.id}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="px-2.5 py-1 text-xs font-semibold text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-lg transition-colors"
                                                    >
                                                        {t('adopter.dup_action_view') || 'View profile'}
                                                    </a>
                                                    {onContinueWith && (
                                                        <button
                                                            type="button"
                                                            onClick={() => onContinueWith(result.adopter.id)}
                                                            disabled={busyAdopterId === result.adopter.id}
                                                            className="px-2.5 py-1 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-600 disabled:opacity-50 rounded-lg transition-colors"
                                                        >
                                                            {busyAdopterId === result.adopter.id
                                                                ? (t('common.processing') || '...')
                                                                : (t('adopter.dup_action_continue_with_existing') || 'Continue with this profile')}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                </div>
            )}
        </>
    );
}
