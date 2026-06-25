'use client';

/**
 * Shared adopter search-result card. Rendered by SearchSection (real results,
 * linked + login-gated) and by the guided-walkthrough demo (inert, no href).
 * Keeping ONE card means the demo shows the exact real masking/rating/flags UI.
 */

import React from 'react';
import type { DiscoveryMatch, SnippetField } from '@/app/actions';
import { RatingBadge } from './RatingBadge';
import { RatingExplainer } from './RatingExplainer';
import { useLanguage } from '@/context/LanguageContext';
import { formatShortDate } from '@/lib/dates';

const SNIPPET_ICONS: Record<SnippetField, string> = {
    name: '👤', contact: '📞', address: '📍',
    family: '👨‍👩‍👧', adoption: '🐾', history: '📝',
};

function renderHighlightedSnippet(snippet: string, highlights: { start: number; end: number }[]) {
    if (highlights.length === 0) return null;
    const parts: React.ReactNode[] = [];
    let lastEnd = 0;
    for (const h of highlights) {
        if (h.start > lastEnd) parts.push(snippet.slice(lastEnd, h.start));
        parts.push(
            <mark key={h.start} className="bg-amber-200/70 text-stone-900 rounded px-0.5 font-medium">
                {snippet.slice(h.start, h.end)}
            </mark>
        );
        lastEnd = h.end;
    }
    if (lastEnd < snippet.length) parts.push(snippet.slice(lastEnd));
    return <>{parts}</>;
}

export interface AdopterResultCardProps {
    match: DiscoveryMatch;
    isAuthenticated: boolean;
    /** Show the views/dates metadata row (off on embeds that want a leaner card). */
    showMetadata?: boolean;
    /** Profile link target. When omitted the card is inert (walkthrough demo). */
    href?: string;
    onClick?: (e: React.MouseEvent) => void;
}

export function AdopterResultCard({ match: res, isAuthenticated, showMetadata = true, href, onClick }: AdopterResultCardProps) {
    const { t } = useLanguage();

    const addedDate = res.adopter.createdAt ? formatShortDate(res.adopter.createdAt) : null;
    const updatedDate = res.adopter.updatedAt ? formatShortDate(res.adopter.updatedAt) : null;

    const inner = (
        <div className="bg-white rounded-xl p-4 shadow-sm border border-stone-200 group-hover:border-teal-300 group-hover:shadow-md transition-all">
            {/* Top Row: Avatar + Name/Contact + Rating */}
            <div className="flex items-center gap-3 mb-3">
                <div className="w-12 h-12 rounded-full bg-stone-100 flex-shrink-0 overflow-hidden ring-2 ring-white shadow-sm">
                    {res.thumbnail ? (
                        <img src={res.thumbnail} alt="" className="w-full h-full object-cover" />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-stone-500">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                        </div>
                    )}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-semibold text-stone-900 group-hover:text-teal-700 transition-colors truncate" title={res.adopter.name}>
                            {isAuthenticated && res.matchSnippet?.field === 'name' && res.matchSnippet.snippet === res.adopter.name
                                ? (renderHighlightedSnippet(res.adopter.name, res.matchSnippet.highlights) || res.adopter.name)
                                : res.adopter.name}
                        </span>
                        {res.adopter.isPublic === 1 && (
                            <span className="flex-shrink-0 inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded bg-sky-100 text-sky-700" title={t('search.public_title')}>
                                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                    <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                                </svg>
                                {t('search.public_label')}
                            </span>
                        )}
                    </div>
                    <div className="text-xs text-stone-500 truncate" title={res.adopter.contactInfo || undefined}>
                        {isAuthenticated && res.matchSnippet?.field === 'contact' && res.matchSnippet.snippet === res.adopter.contactInfo
                            ? (renderHighlightedSnippet(res.adopter.contactInfo, res.matchSnippet.highlights) || res.adopter.contactInfo)
                            : (res.adopter.contactInfo || t('common.no_contact'))}
                        {!isAuthenticated && res.adopter.contactInfo && (
                            <span className="ml-1 text-teal-700 font-medium">• {t('search.login_to_view')}</span>
                        )}
                    </div>
                </div>
                {res.avgRating !== null && (
                    <div className="flex-shrink-0">
                        <RatingExplainer rating={res.avgRating}>
                            <RatingBadge rating={res.avgRating} size="sm" label="search" />
                        </RatingExplainer>
                    </div>
                )}
            </div>

            {/* Stats Row */}
            <div className="flex flex-wrap items-center gap-3 text-xs text-stone-500">
                {showMetadata && (
                    <span>👁 {res.stats.profileViews} {t('stats.views')}</span>
                )}
                <span>📋 {res.stats.requests} {t('stats.requests')}</span>
                <span>🏠 {res.stats.adoptions} {t('stats.adoptions')}</span>
                <div className="flex flex-wrap gap-1 ml-auto">
                    {res.flags.inaccurate && (
                        <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-rose-100 text-rose-700">⚠ {t('flags.inaccurate') || 'Inaccurate'}</span>
                    )}
                    {res.flags.duplicate && (
                        <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-amber-100 text-amber-700">📄 {t('flags.duplicate') || 'Duplicate'}</span>
                    )}
                    {res.flags.systemDuplicate && !res.flags.duplicate && (
                        <span
                            title={t('search.possible_duplicate_tooltip') || 'El sistema detectó otro registro similar. El responsable del registro puede revisarlo.'}
                            className="text-xs px-1.5 py-0.5 rounded font-medium bg-stone-100 text-stone-600 cursor-help"
                        >
                            🔍 {t('flags.possible_duplicate') || 'Possible duplicate'}
                        </span>
                    )}
                    {res.flags.verified_identity && (
                        <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-teal-100 text-teal-700">✓ {t('flags.verified_identity') || 'Verified ID'}</span>
                    )}
                    {res.flags.verified_address && (
                        <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-emerald-100 text-emerald-700">✓ {t('flags.verified_address') || 'Verified address'}</span>
                    )}
                    {res.flags.tooManyAdoptions && (
                        <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-orange-100 text-orange-700">⚠ {t('flags.too_many_adoptions').replace('{count}', res.flags.tooManyAdoptions.count.toString()).replace('{days}', Math.round(res.flags.tooManyAdoptions.actualSpanDays || res.flags.tooManyAdoptions.periodDays).toString())}</span>
                    )}
                    {res.flags.tooManyRequests && (
                        <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-purple-100 text-purple-700">⚠ {t('flags.too_many_requests').replace('{count}', res.flags.tooManyRequests.count.toString()).replace('{days}', Math.round(res.flags.tooManyRequests.actualSpanDays || res.flags.tooManyRequests.periodDays).toString())}</span>
                    )}
                </div>
            </div>

            {/* Match Snippet — shows why this result appeared */}
            {res.matchSnippet && (() => {
                const s = res.matchSnippet;
                if (s.field === 'name' || s.field === 'contact') return null;
                const icon = SNIPPET_ICONS[s.field];
                const label = t(`search.snippet_${s.field}`);
                return (
                    <div className="mt-2 flex items-start gap-2 text-xs text-stone-600 bg-stone-50 px-3 py-2 rounded-lg border border-stone-100">
                        <span className="flex-shrink-0 mt-0.5">{icon}</span>
                        <span className="min-w-0 break-words">
                            <span className="font-semibold text-stone-500">{label}:</span>{' '}
                            {s.field === 'history' ? (
                                <span className="italic">{t('search.snippet_history_generic')}</span>
                            ) : !isAuthenticated ? (
                                <span className="italic">{t('search.protected_info') || 'Información protegida'}</span>
                            ) : (
                                renderHighlightedSnippet(s.snippet, s.highlights) || s.snippet
                            )}
                        </span>
                    </div>
                );
            })()}

            {/* Dates Row - bottom right */}
            {showMetadata && (addedDate || updatedDate) && (
                <div className="flex justify-end gap-3 mt-2 pt-2 border-t border-stone-100 text-xs text-stone-500">
                    {addedDate && (<span>📅 {addedDate}</span>)}
                    {updatedDate && (<span>✏️ {updatedDate}</span>)}
                </div>
            )}
        </div>
    );

    if (href) {
        return (
            <a href={href} onClick={onClick} className="block group">{inner}</a>
        );
    }
    return <div className="block group">{inner}</div>;
}
