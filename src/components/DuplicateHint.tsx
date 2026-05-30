'use client';

/**
 * Inline cross-record duplicate warning.
 *
 * Fires when the user types a high-confidence identifier (phone / email /
 * social / id) that matches another adopter. Renders an amber chip with up
 * to N masked matches and two actions per match:
 *
 *   - "Ver perfil" — opens the matched profile in a NEW TAB after writing
 *     a search-match grant (via `grantSearchMatchAccess`) so the destination
 *     renders unmasked. New tab keeps the user's in-progress composer state
 *     intact.
 *   - "Fusionar" — opens the existing `DuplicateMergeModal` with the
 *     current adopter and the matched adopter pre-selected. Confirms via
 *     `mergeAdoptersFromHint` (owner-or-admin gated server-side).
 *
 * Why initials and not full name: `findAdopters` mode='duplicate' returns
 * `adopterName` raw (the response shape predates PII gating; admin scans
 * and the unauthenticated contract route are its only other callers).
 * Rendering initials here keeps the hint from leaking name PII before the
 * user explicitly clicks "Ver perfil" — which IS proof they know the
 * identifier and earns them a search-match grant.
 *
 * Theming: text-amber-800 (NOT 900) on the dark-tinted background. amber-900
 * has no [data-theme="dark"] remap and renders as near-black on the amber
 * tint (the v2.14.9-4 contrast bug, documented in RecordTypeGuidance.tsx).
 * amber-50/100/200 backgrounds and amber-700 icon ARE remapped.
 */

import { useEffect, useRef, useState } from 'react';
import { findAdopters, grantSearchMatchAccess, mergeAdoptersFromHint, type DuplicateMatch } from '@/app/actions';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { extractErrorId } from '@/lib/errorUtils';
import type { ContactEntryType } from '@/lib/contactEntries';
import DuplicateMergeModal from '@/components/DuplicateMergeModal';

interface Props {
    /** Strong identifier type the user just typed. Address/alias/other are no-op. */
    type: ContactEntryType;
    /** The typed value. Empty string clears the hint. Whitespace is ignored. */
    value: string;
    /** Adopter to exclude from results (the user's own profile when editing). */
    excludeAdopterId?: string;
    /** Current adopter's display name — needed to populate the merge modal. */
    currentAdopterName?: string;
    /** Optional callback fired after grant write succeeds, before navigation. */
    onMatch?: (adopterId: string) => void;
    className?: string;
}

// Strong identifiers that trigger the hint. Address-only matches are noisy
// (households, apartments) — suppressed by the minRelevance floor below.
const STRONG_TYPES: ReadonlySet<ContactEntryType> = new Set(['phone', 'email', 'social', 'id']);

const MAX_RESULTS = 3;
// Floor relevance to suppress address-word-only and weak fuzzy-name hits.
const MIN_RELEVANCE = 40;

function buildInput(type: ContactEntryType, value: string, excludeAdopterId?: string) {
    const v = value.trim();
    switch (type) {
        case 'phone':
            return { phones: [v], excludeAdopterId };
        case 'email':
            return { emails: [v.toLowerCase()], excludeAdopterId };
        case 'social':
            return { socials: [v.toLowerCase()], excludeAdopterId };
        case 'id':
            // No structured `ids` input; pass via contactInfo so the extractor picks it up.
            return { contactInfo: v, excludeAdopterId };
        default:
            return null;
    }
}

function initials(name: string): string {
    return name
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(w => (w[0] || '').toUpperCase() + '.')
        .join(' ');
}

export default function DuplicateHint({ type, value, excludeAdopterId, currentAdopterName, onMatch, className }: Props) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const [matches, setMatches] = useState<DuplicateMatch[]>([]);
    const [loading, setLoading] = useState(false);
    const [viewing, setViewing] = useState<string | null>(null);
    const [mergeTarget, setMergeTarget] = useState<DuplicateMatch | null>(null);
    const [merging, setMerging] = useState(false);
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        // Cancel any in-flight request from a previous value.
        if (abortRef.current) {
            abortRef.current.abort();
            abortRef.current = null;
        }

        const v = value.trim();
        if (!v || !STRONG_TYPES.has(type)) {
            setMatches([]);
            setLoading(false);
            return;
        }

        const input = buildInput(type, v, excludeAdopterId);
        if (!input) {
            setMatches([]);
            setLoading(false);
            return;
        }

        const ctl = new AbortController();
        abortRef.current = ctl;
        setLoading(true);

        (async () => {
            try {
                const res = await findAdopters(input, {
                    mode: 'duplicate',
                    limit: MAX_RESULTS,
                    minRelevance: MIN_RELEVANCE,
                });
                if (ctl.signal.aborted) return;
                const dup = (res.results as DuplicateMatch[]) ?? [];
                setMatches(dup);
            } catch {
                if (!ctl.signal.aborted) setMatches([]);
            } finally {
                if (!ctl.signal.aborted) setLoading(false);
            }
        })();

        return () => {
            ctl.abort();
        };
    }, [type, value, excludeAdopterId]);

    if (loading) {
        return (
            <div className={`flex items-center gap-2 text-xs text-stone-500 ${className ?? ''}`}>
                <span className="inline-block w-3 h-3 border-2 border-stone-400 border-t-transparent rounded-full animate-spin" aria-hidden />
                <span>{t('adopter.dup_hint_checking') || 'Buscando coincidencias...'}</span>
            </div>
        );
    }

    if (matches.length === 0) return null;

    const handleView = async (adopterId: string) => {
        setViewing(adopterId);
        try {
            const res = await grantSearchMatchAccess({ adopterId, query: value.trim() });
            if (res.ok) onMatch?.(adopterId);
            // Open the destination in a NEW TAB so the user's in-progress
            // composer state on the current adopter is preserved. The grant
            // write above is awaited so the new tab loads unmasked.
            window.open(`/adopter/${adopterId}`, '_blank', 'noopener,noreferrer');
        } finally {
            setViewing(null);
        }
    };

    const handleMerge = async (primaryId: string, secondaryId: string) => {
        setMerging(true);
        try {
            const result = await mergeAdoptersFromHint(primaryId, secondaryId);
            if (result.success) {
                // ALWAYS navigate to the surviving primary, regardless of
                // which side the current page was. Reloading the current
                // page when the current adopter was just soft-deleted
                // produced an RSC-render error (the page's server component
                // tried to fetch a deletedAt-set row). Hard-navigating to
                // the primary's URL avoids that entirely — primary always
                // exists post-merge. Do NOT setMergeTarget(null) first;
                // unmounting the modal mid-navigation can race with the
                // browser teardown.
                toast.success('✓', t('adopter.dup_hint_merge_success') || 'Perfiles fusionados');
                window.location.href = `/adopter/${primaryId}`;
            } else {
                toast.error(
                    t('errors.generic') || 'Error',
                    result.error || (t('adopter.dup_hint_merge_failed') || 'No se pudo fusionar'),
                );
            }
        } catch (e) {
            // Surface the actual rejection so future bugs are diagnosable —
            // ClientErrorReporter would only show a generic "Algo salió mal".
            console.error('[DuplicateHint] mergeAdoptersFromHint threw:', e);
            toast.error(t('errors.generic') || 'Error', undefined, extractErrorId(e));
        } finally {
            setMerging(false);
        }
    };

    const headerKey = matches.length === 1 ? 'adopter.dup_hint_one' : 'adopter.dup_hint_many';
    const headerFallback = matches.length === 1
        ? 'Este dato ya está en otro perfil'
        : `Este dato coincide con ${matches.length} perfiles`;
    const headerText = (t(headerKey) || headerFallback).replace('{n}', String(matches.length));

    return (
        <>
            <div
                className={`mt-2 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3 ${className ?? ''}`}
                role="note"
            >
                <span className="text-amber-700 shrink-0 mt-0.5" aria-hidden>⚠</span>
                <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-amber-800">{headerText}</p>
                    <ul className="mt-1.5 space-y-1.5">
                        {matches.map(m => {
                            const isViewing = viewing === m.adopterId;
                            const busy = isViewing || merging;
                            return (
                                <li key={m.adopterId} className="flex flex-wrap items-center gap-2 text-xs">
                                    <span className="font-medium text-stone-800 truncate">
                                        {initials(m.adopterName) || '—'}
                                    </span>
                                    <div className="ml-auto flex items-center gap-1.5">
                                        <button
                                            type="button"
                                            onClick={() => handleView(m.adopterId)}
                                            disabled={busy}
                                            className="px-2 py-0.5 rounded-md text-[11px] font-semibold text-amber-800 bg-amber-100 hover:bg-amber-200 disabled:opacity-50 border border-amber-200"
                                        >
                                            {isViewing
                                                ? (t('adopter.dup_hint_navigating') || 'Abriendo...')
                                                : (t('adopter.dup_hint_view') || 'Ver perfil')}
                                        </button>
                                        {excludeAdopterId && currentAdopterName && (
                                            <button
                                                type="button"
                                                onClick={() => setMergeTarget(m)}
                                                disabled={busy}
                                                className="px-2 py-0.5 rounded-md text-[11px] font-semibold text-white bg-teal-700 hover:bg-teal-600 disabled:opacity-50"
                                            >
                                                {t('adopter.dup_hint_merge') || 'Fusionar'}
                                            </button>
                                        )}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            </div>

            {mergeTarget && excludeAdopterId && currentAdopterName && (
                <DuplicateMergeModal
                    adopter1={{ id: excludeAdopterId, name: currentAdopterName }}
                    adopter2={{ id: mergeTarget.adopterId, name: mergeTarget.adopterName }}
                    matchTypes={mergeTarget.matchTypes}
                    onMerge={handleMerge}
                    onClose={() => { if (!merging) setMergeTarget(null); }}
                />
            )}
        </>
    );
}
