'use client';

/**
 * Inline cross-record duplicate warning.
 *
 * Fires when the user types a high-confidence identifier (phone / email /
 * social / id) that matches another adopter. Renders an amber chip with up
 * to N masked matches and a "View match" button that triggers the
 * search-match grant write (via `grantSearchMatchAccess`) before navigating
 * to the destination profile.
 *
 * Why initials and not full name: `findAdopters` mode='duplicate' returns
 * `adopterName` raw (the response shape predates PII gating; admin scans
 * and the unauthenticated contract route are its only other callers).
 * Rendering initials here keeps the hint from leaking name PII before the
 * user explicitly clicks "View match" — which IS proof they know the
 * identifier and earns them a search-match grant.
 *
 * Why no auto-debounce on prop change: the consumer controls when to set
 * `value` to a non-empty string (typically the user's explicit +Add click
 * or 350ms debounce). This component re-fetches whenever `value` changes
 * and aborts in-flight requests on subsequent changes.
 *
 * Themed Tailwind only (per `feedback_themed_colors_only`): amber-50/100/
 * 200 + text-amber-700/800/900 + stone-* — all verified against
 * globals.css.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { findAdopters, grantSearchMatchAccess, type DuplicateMatch } from '@/app/actions';
import { useLanguage } from '@/context/LanguageContext';
import type { ContactEntryType } from '@/lib/contactEntries';

interface Props {
    /** Strong identifier type the user just typed. Address/alias/other are no-op. */
    type: ContactEntryType;
    /** The typed value. Empty string clears the hint. Whitespace is ignored. */
    value: string;
    /** Adopter to exclude from results (the user's own profile when editing). */
    excludeAdopterId?: string;
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

export default function DuplicateHint({ type, value, excludeAdopterId, onMatch, className }: Props) {
    const { t } = useLanguage();
    const router = useRouter();
    const [matches, setMatches] = useState<DuplicateMatch[]>([]);
    const [loading, setLoading] = useState(false);
    const [viewing, setViewing] = useState<string | null>(null);
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
            // Navigate whether or not the grant write succeeded — the destination
            // page will mask appropriately if it didn't, and the user can retry
            // via the on-profile verify-known-info input.
            router.push(`/adopter/${adopterId}`);
        } finally {
            setViewing(null);
        }
    };

    const headerKey = matches.length === 1 ? 'adopter.dup_hint_one' : 'adopter.dup_hint_many';
    const headerFallback = matches.length === 1
        ? 'Este dato ya está en otro perfil'
        : `Este dato coincide con ${matches.length} perfiles`;
    const headerText = (t(headerKey) || headerFallback).replace('{n}', String(matches.length));

    return (
        <div
            className={`mt-2 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3 ${className ?? ''}`}
            role="note"
        >
            <span className="text-amber-700 shrink-0 mt-0.5" aria-hidden>⚠</span>
            <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-amber-900">{headerText}</p>
                <ul className="mt-1.5 space-y-1">
                    {matches.map(m => {
                        const isViewing = viewing === m.adopterId;
                        return (
                            <li key={m.adopterId} className="flex items-center gap-2 text-xs">
                                <span className="font-medium text-stone-800 truncate">
                                    {initials(m.adopterName) || '—'}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => handleView(m.adopterId)}
                                    disabled={isViewing || viewing !== null}
                                    className="ml-auto px-2 py-0.5 rounded-md text-[11px] font-semibold text-amber-900 bg-amber-100 hover:bg-amber-200 disabled:opacity-50 border border-amber-200"
                                >
                                    {isViewing
                                        ? (t('adopter.dup_hint_navigating') || 'Abriendo...')
                                        : (t('adopter.dup_hint_view') || 'Ver perfil')}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </div>
    );
}
