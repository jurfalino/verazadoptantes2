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
import { AdopterName } from './AdopterName';
import { useLanguage } from '@/context/LanguageContext';
import { formatShortDate } from '@/lib/dates';
import { isNamelessAdopter } from '@/lib/adopterDisplay';

const SNIPPET_ICONS: Record<SnippetField, string> = {
    name: '👤', contact: '📞', address: '📍',
    family: '👨‍👩‍👧', adoption: '🐾', history: '📝',
};

// Icons for the specific structured contact-entry type of a masked match, so a
// protected address match reads "📍 …dirección" rather than the generic "📞".
const ENTRY_ICONS: Record<string, string> = {
    phone: '📞', email: '✉️', social: '🔗', id: '🪪', address: '📍', alias: '👤', other: '📇',
};

/**
 * Highlight ranges for the query's tokens within the (always-visible, never-masked)
 * name — computed client-side, independent of `matchSnippet`. Fixes the case where a
 * multi-field query (e.g. "jonatan 65851333") picks the phone as the "best" snippet,
 * that snippet gets PII-scrubbed, and the matched name ends up un-highlighted.
 * Accent/case-insensitive: `normalizeText` NFD-strips 1:1 (é→e) so offsets computed on
 * the normalized string map back onto the original name. No trim (would shift offsets).
 */
function normForOffsets(s: string): string {
    return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function tokenHighlightRanges(name: string, query: string): { start: number; end: number }[] {
    if (!name || !query) return [];
    const normName = normForOffsets(name);
    const tokens = [...new Set(query.trim().split(/\s+/).map(normForOffsets).filter(t => t.length >= 2))];
    const ranges: { start: number; end: number }[] = [];
    for (const tok of tokens) {
        let idx = normName.indexOf(tok);
        while (idx !== -1) {
            ranges.push({ start: idx, end: idx + tok.length });
            idx = normName.indexOf(tok, idx + tok.length);
        }
    }
    if (ranges.length === 0) return [];
    // Sort + merge overlaps so renderHighlightedSnippet's ascending, non-overlapping
    // contract holds (e.g. query "ana anabel" over "Ana Anabela").
    ranges.sort((a, b) => a.start - b.start);
    const merged: { start: number; end: number }[] = [ranges[0]];
    for (let i = 1; i < ranges.length; i++) {
        const last = merged[merged.length - 1];
        if (ranges[i].start <= last.end) last.end = Math.max(last.end, ranges[i].end);
        else merged.push(ranges[i]);
    }
    return merged;
}

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
    /** The search query — used to highlight matched tokens in the name. */
    query?: string;
    /**
     * Rendered under "Ampliar la búsqueda". Those results are, by construction,
     * the ones that do NOT contain the query literally — the fuzzy tier excludes
     * everything already shown above — so the highlighter has nothing to mark and
     * the card looked like it matched nothing at all. This says why it is there.
     */
    weakMatch?: boolean;
}

export function AdopterResultCard({ match: res, isAuthenticated, showMetadata = true, href, onClick, query = '', weakMatch = false }: AdopterResultCardProps) {
    const { t } = useLanguage();
    const nameRanges = tokenHighlightRanges(res.adopter.name, query);
    const contactRanges = tokenHighlightRanges(res.adopter.contactInfo || '', query);

    const addedDate = res.adopter.createdAt ? formatShortDate(res.adopter.createdAt) : null;
    const updatedDate = res.adopter.updatedAt ? formatShortDate(res.adopter.updatedAt) : null;

    // Extracted so each element renders in ONE source of truth but lands in a
    // different slot per breakpoint (desktop = today's [name/contact][rating];
    // mobile = [name/rating] with risk flags + contact promoted full-width below).
    const ratingBadge = res.avgRating !== null ? (
        <RatingExplainer rating={res.avgRating}>
            <RatingBadge rating={res.avgRating} size="sm" label="search" />
        </RatingExplainer>
    ) : null;

    // Contact line content (highlighted contactInfo + login nudge), reused in the
    // desktop middle-column slot and the mobile full-width slot.
    const contactNode = (
        <>
            {res.adopter.contactInfo
                ? (contactRanges.length > 0
                    ? (renderHighlightedSnippet(res.adopter.contactInfo, contactRanges) || res.adopter.contactInfo)
                    : res.adopter.contactInfo)
                : t('common.no_contact')}
            {!isAuthenticated && res.adopter.contactInfo && (
                <span className="ml-1 text-teal-700 font-medium">• {t('search.login_to_view')}</span>
            )}
        </>
    );

    // The two "too many …" risk chips. Promoted on mobile to sit right under the
    // rating (C layout); on desktop they stay inline in the stats band below.
    const riskFlagChips = (
        <>
            {res.flags.tooManyAdoptions && (
                <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-orange-100 text-orange-700">⚠ {t('flags.too_many_adoptions').replace('{count}', res.flags.tooManyAdoptions.count.toString()).replace('{days}', Math.round(res.flags.tooManyAdoptions.actualSpanDays || res.flags.tooManyAdoptions.periodDays).toString())}</span>
            )}
            {res.flags.tooManyRequests && (
                <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-purple-100 text-purple-700">⚠ {t('flags.too_many_requests').replace('{count}', res.flags.tooManyRequests.count.toString()).replace('{days}', Math.round(res.flags.tooManyRequests.actualSpanDays || res.flags.tooManyRequests.periodDays).toString())}</span>
            )}
        </>
    );
    const hasRiskFlags = Boolean(res.flags.tooManyAdoptions || res.flags.tooManyRequests);

    const inner = (
        <div className="bg-white rounded-xl p-4 shadow-sm border border-stone-200 group-hover:border-teal-300 group-hover:shadow-md transition-all">
            {/* Top Row. Desktop = [avatar][name/contact][rating] (unchanged);
                mobile = [avatar][name] with the rating wrapping to its own line under
                the name (flex-wrap + basis-full), and contact promoted full-width below.
                The rating is a SINGLE DOM instance repositioned by CSS — not duplicated —
                so a test selecting the rating badge never resolves to a hidden copy. */}
            <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5 mb-3">
                <div className="w-12 h-12 rounded-full bg-stone-100 flex-none overflow-hidden ring-2 ring-white shadow-sm">
                    {res.thumbnail ? (
                        <img src={res.thumbnail} alt="" className="w-full h-full object-cover" />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-stone-500">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                        </div>
                    )}
                </div>
                <div className="flex-1 min-w-0">
                    {/* Name + public badge. The name is content-width (NOT flex-1) so
                        the "Público" badge hugs it inline instead of being shoved to the
                        far-right edge of the column. min-w-0 still lets a long name shrink
                        and line-clamp; the badge is flex-shrink-0 so it never collapses. */}
                    <div className="flex items-start gap-1.5 min-w-0">
                        {/* Highlight matched query tokens directly in the visible name —
                            works regardless of which field won matchSnippet (and even when
                            that field was masked/scrubbed). Name is never PII-masked. */}
                        {isNamelessAdopter(res.adopter)
                            ? <AdopterName adopter={res.adopter} className="font-semibold text-stone-900 group-hover:text-teal-700 transition-colors line-clamp-2 min-w-0" title />
                            : (
                                <span className="font-semibold text-stone-900 group-hover:text-teal-700 transition-colors line-clamp-2 min-w-0" title={res.adopter.name}>
                                    {nameRanges.length > 0
                                        ? (renderHighlightedSnippet(res.adopter.name, nameRanges) || res.adopter.name)
                                        : res.adopter.name}
                                </span>
                            )}
                        {/* Visibility badge — mirror of the profile header's 3-state
                            badge (server-computed `visibilityBadge`, no modal on the
                            card): Público (eye/sky), Protegido-sin-acceso (closed
                            padlock/stone), Protegido-con-acceso (open padlock/teal —
                            the viewer has full access). v2.26.3: eye reads clearly at
                            12px; open-vs-closed padlock is the locked/unlocked cue. */}
                        {res.visibilityBadge === 'public' ? (
                            <span
                                className="flex-shrink-0 inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded"
                                style={{ backgroundColor: 'var(--status-sky-bg)', color: 'var(--status-sky-text)' }}
                                title={t('search.public_title')}
                            >
                                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                    <path d="M2.5 12S6 5.5 12 5.5s9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" />
                                    <circle cx="12" cy="12" r="3" />
                                </svg>
                                {t('search.public_label')}
                            </span>
                        ) : res.visibilityBadge === 'protected-unlocked' ? (
                            <span
                                className="flex-shrink-0 inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded"
                                style={{ backgroundColor: 'var(--accent-badge-bg)', color: 'var(--accent-badge-text)' }}
                                title={t('search.protected_unlocked_title')}
                            >
                                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                    <rect x="3.5" y="11" width="17" height="10" rx="2" />
                                    <path d="M7.5 11V7a4.5 4.5 0 0 1 8.5-2" />
                                </svg>
                                {t('search.protected_unlocked_label')}
                            </span>
                        ) : res.visibilityBadge === 'protected-locked' ? (
                            <span
                                className="flex-shrink-0 inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded bg-stone-100 text-stone-500"
                                title={t('search.protected_title')}
                            >
                                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                    <rect x="3.5" y="11" width="17" height="10" rx="2" />
                                    <path d="M7.5 11V7.5a4.5 4.5 0 0 1 9 0V11" />
                                </svg>
                                {t('search.protected_label')}
                            </span>
                        ) : null}
                    </div>
                    {/* Desktop: contact stays in the middle column under the name.
                        Full string, always wrapped (never truncated), matched tokens
                        highlighted in place — nothing hidden behind a "…". */}
                    <div className="hidden md:block text-xs text-stone-500 break-words" title={res.adopter.contactInfo || undefined}>
                        {contactNode}
                    </div>
                </div>
                {/* Rating — one instance, repositioned by CSS. Desktop: pinned right in
                    natural order. Mobile: basis-full forces it onto its own line under the
                    name, pl indents it past the 48px avatar so it sits under the name. */}
                {ratingBadge && (
                    <div className="flex-none basis-full md:basis-auto pl-[3.75rem] md:pl-0">
                        {ratingBadge}
                    </div>
                )}
            </div>

            {/* Mobile C layout: risk flags right after the rating, then contact
                full-width. Both hidden on desktop (rating flags live in the stats
                band; contact lives in the middle column). */}
            {hasRiskFlags && (
                <div className="md:hidden flex flex-wrap gap-1.5 mb-2">{riskFlagChips}</div>
            )}
            <div className="md:hidden text-xs text-stone-500 break-words mb-3" title={res.adopter.contactInfo || undefined}>
                {contactNode}
            </div>

            {/* Why this one is in the widened tier — it has no literal match to
                highlight, so without this the card reads as a random record. */}
            {weakMatch && query.trim() && (
                <div className="mb-2">
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded bg-stone-100 text-stone-600">
                        ≈ {t('search.weak_reason').replace('{query}', query.trim())}
                    </span>
                </div>
            )}

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
                    {/* Desktop: risk chips inline in the stats band. On mobile they're
                        promoted above (right after the rating), so hide them here —
                        `md:contents` lets them flow into this flex cluster on ≥md. */}
                    <span className="hidden md:contents">{riskFlagChips}</span>
                </div>
            </div>

            {/* Match Snippet — shows why this result appeared */}
            {res.matchSnippet && (() => {
                const s = res.matchSnippet;
                // Name is highlighted inline in the name.
                if (s.field === 'name') return null;
                // A contact match is shown on the contact line above. Only surface a
                // "matched on a protected field" chip when the matched value is
                // GENUINELY hidden — i.e. the query tokens don't appear in the
                // (possibly partially-revealed) contact string. Checking token
                // visibility, not the snippet: the snippet is scrubbed to empty for
                // any partially-masked record even when a search-match grant reveals
                // the value on the line, so "empty snippet" alone would wrongly show
                // "protegida" on a record whose contact you can actually see.
                if (s.field === 'contact') {
                    const cinfo = normForOffsets(res.adopter.contactInfo || '');
                    const matchVisible = query.trim().split(/\s+/)
                        .map(normForOffsets).filter(tk => tk.length >= 2)
                        .some(tk => cinfo.includes(tk));
                    if (s.snippet || matchVisible) return null;
                }

                // History: no value to show, generic cue.
                if (s.field === 'history') {
                    return (
                        <div className="mt-2 flex items-start gap-2 text-xs text-stone-600 bg-stone-50 px-3 py-2 rounded-lg border border-stone-100">
                            <span className="flex-shrink-0 mt-0.5">{SNIPPET_ICONS.history}</span>
                            <span className="min-w-0 break-words">
                                <span className="font-semibold text-stone-500">{t('search.snippet_history')}:</span>{' '}
                                <span className="italic">{t('search.snippet_history_generic')}</span>
                            </span>
                        </div>
                    );
                }

                // Masked field (empty snippet, or unauthenticated): name the PRECISE
                // field that matched instead of a blank/generic chip — for a contact
                // blob, the specific entry type (address/phone/email/…); otherwise the
                // field itself. e.g. "📍 Coincide en Dirección · dato protegido".
                if (!isAuthenticated || !s.snippet) {
                    const type = s.matchedEntryType;
                    const fieldLabel = type ? t(`adopter.ce_type_${type}`) : t(`search.snippet_${s.field}`);
                    const icon = (type && ENTRY_ICONS[type]) || SNIPPET_ICONS[s.field];
                    // When this field matched only PARTIALLY (not all query tokens landed
                    // in it — `${field}_partial` in matchTypes), say so, so a weak/partial
                    // masked hit reads as tentative ("Coincidencia parcial en …") rather
                    // than asserting a full match on a value you can't see. Reveal logic is
                    // unchanged — this only affects the wording of the masked chip.
                    const fieldPartial = res.matchTypes?.includes(`${s.field}_partial`) ?? false;
                    const key = fieldPartial ? 'search.protected_match_partial' : 'search.protected_match';
                    return (
                        <div className="mt-2 flex items-start gap-2 text-xs text-stone-500 bg-stone-50 px-3 py-2 rounded-lg border border-stone-100 italic">
                            <span className="flex-shrink-0 mt-0.5 not-italic">{icon}</span>
                            <span className="min-w-0 break-words">
                                {t(key).replace('{field}', fieldLabel)}
                            </span>
                        </div>
                    );
                }

                // Visible field match (address / family / adoption): show the value.
                return (
                    <div className="mt-2 flex items-start gap-2 text-xs text-stone-600 bg-stone-50 px-3 py-2 rounded-lg border border-stone-100">
                        <span className="flex-shrink-0 mt-0.5">{SNIPPET_ICONS[s.field]}</span>
                        <span className="min-w-0 break-words">
                            <span className="font-semibold text-stone-500">{t(`search.snippet_${s.field}`)}:</span>{' '}
                            {renderHighlightedSnippet(s.snippet, s.highlights) || s.snippet}
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

    // scroll-mt clears the sticky search header so a scrolled-to card (e.g. the
    // walkthrough spotlight) isn't tucked under it on mobile.
    if (href) {
        return (
            <a href={href} onClick={onClick} className="block group scroll-mt-28 md:scroll-mt-4">{inner}</a>
        );
    }
    return <div className="block group scroll-mt-28 md:scroll-mt-4">{inner}</div>;
}
