'use client';

/**
 * Persistent inline strip rendered above the AdopterForm save button. Surfaces
 * up to 2 "strong" duplicate matches (exact phone / email / social hits) that
 * the user MUST see — identity collisions are the highest-cost dup vector and
 * must not be missable.
 *
 * Each row is dismissible (×). Dismissed adopter ids are tracked by the parent
 * and feed the save-time modal gate: the modal only fires for strong matches
 * that are still on the strip when the user clicks save.
 */

import type { DiscoveryMatch } from '@/app/actions';
import { buildMatchChips, hasStrongMatch } from '@/lib/matchChips';
import { useLanguage } from '@/context/LanguageContext';

interface Props {
    results: DiscoveryMatch[] | null;
    dismissedIds: Set<string>;
    onDismiss: (adopterId: string) => void;
    onContinueWith?: (adopterId: string) => Promise<void> | void;
    busyAdopterId?: string | null;
}

export default function StrongMatchStrip({ results, dismissedIds, onDismiss, onContinueWith, busyAdopterId }: Props) {
    const { t } = useLanguage();

    const strong = (results ?? [])
        .filter(r => hasStrongMatch(r.matchValues))
        .filter(r => !dismissedIds.has(r.adopter.id))
        .slice(0, 2);

    if (strong.length === 0) return null;

    return (
        <div className="md:col-span-2 rounded-xl border-2 border-amber-300 bg-amber-50 overflow-hidden">
            <div className="px-4 py-2.5 bg-amber-100 border-b border-amber-300 flex items-center gap-2">
                <span aria-hidden>⚠️</span>
                <h3 className="text-sm font-bold text-amber-900">
                    {t('adopter.dup_strong_strip_title') || 'Likely exact match'}
                </h3>
            </div>
            <ul className="divide-y divide-amber-200">
                {strong.map(result => {
                    const chips = buildMatchChips(result.matchValues, t).filter(c => c.isStrong).slice(0, 2);
                    return (
                        <li key={result.adopter.id} className="px-4 py-3 flex items-start gap-3 bg-white/60">
                            {result.thumbnail ? (
                                <img src={result.thumbnail} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
                            ) : (
                                <div className="w-10 h-10 rounded-full bg-amber-200 flex items-center justify-center text-amber-900 font-semibold text-sm flex-shrink-0">
                                    {result.adopter.name?.charAt(0)?.toUpperCase() || '?'}
                                </div>
                            )}
                            <div className="min-w-0 flex-1">
                                <p className="font-semibold text-stone-900 text-sm truncate">{result.adopter.name}</p>
                                <div className="flex flex-wrap gap-1 mt-1">
                                    {chips.map(c => (
                                        <span
                                            key={c.key}
                                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-100 text-amber-900 border border-amber-200"
                                            title={c.label}
                                        >
                                            <span aria-hidden>{c.icon}</span>
                                            <span className="truncate max-w-[180px]">{c.label}</span>
                                        </span>
                                    ))}
                                </div>
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
                            <button
                                type="button"
                                onClick={() => onDismiss(result.adopter.id)}
                                aria-label={t('adopter.dup_action_dismiss') || 'Dismiss'}
                                className="w-7 h-7 rounded-full flex items-center justify-center text-amber-800 hover:bg-amber-200 flex-shrink-0"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
