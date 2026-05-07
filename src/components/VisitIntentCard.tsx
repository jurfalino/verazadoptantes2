'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { zarazTrack } from '@/lib/zaraz';
import AdoptionFormWizard from './AdoptionFormWizard';

type IntentType = 'adoption' | 'adoption_request' | 'observation';

interface AdoptionLite {
    addedBy?: string | null;
    recordType?: string | null;
    date?: number | Date | string | null;
}

interface Props {
    enabled: boolean;
    adopterId: string;
    currentUser: string;
    isOwner: boolean;
    adoptions: AdoptionLite[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    availableAnimals?: any[];
    adopterAddress?: string;
}

const DISMISSAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ALREADY_ACTED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function dismissalKey(adopterId: string, currentUser: string): string {
    return `visit_intent_dismissed_${adopterId}_${currentUser}`;
}

function isWithinWindow(date: number | Date | string | null | undefined, windowMs: number): boolean {
    if (date == null) return false;
    let d: Date;
    if (date instanceof Date) d = date;
    else if (typeof date === 'number') d = new Date(date < 1e12 ? date * 1000 : date);
    else d = new Date(date);
    if (isNaN(d.getTime())) return false;
    return Date.now() - d.getTime() < windowMs;
}

/**
 * Compact one-line prompt rendered above the activity section. Uses theme
 * CSS variables only (works under any [data-theme] palette) and animates in
 * on mount. The card asks the visitor's intent and routes to the matching
 * wizard with the recordType pre-selected.
 *
 * Visibility matrix: feature flag enabled, current user authenticated, not
 * the profile owner, no recent dismissal (per-(adopter, user) localStorage
 * with 7-day TTL), and at least one option not suppressed by recent matching
 * records (30-day window for A and B; C is always available).
 */
export default function VisitIntentCard({ enabled, adopterId, currentUser, isOwner, adoptions, availableAnimals, adopterAddress = '' }: Props) {
    const { t } = useLanguage();
    const [hidden, setHidden] = useState(false);
    const [openedRecordType, setOpenedRecordType] = useState<IntentType | null>(null);
    const [trackedShown, setTrackedShown] = useState(false);

    const baseEligible = enabled && !isOwner && !!currentUser;

    const userActedRequest = useMemo(() => adoptions.some(
        a => a.addedBy === currentUser
            && a.recordType === 'adoption_request'
            && isWithinWindow(a.date ?? null, ALREADY_ACTED_WINDOW_MS)
    ), [adoptions, currentUser]);

    const userActedAdoption = useMemo(() => adoptions.some(
        a => a.addedBy === currentUser
            && a.recordType === 'adoption'
            && isWithinWindow(a.date ?? null, ALREADY_ACTED_WINDOW_MS)
    ), [adoptions, currentUser]);

    const showA = !userActedRequest;
    const showB = !userActedAdoption;
    const showC = true;
    const anyVisible = showA || showB || showC;

    useEffect(() => {
        if (!baseEligible) return;
        try {
            const raw = localStorage.getItem(dismissalKey(adopterId, currentUser));
            if (raw) {
                const ts = Number(raw);
                if (Number.isFinite(ts) && Date.now() - ts < DISMISSAL_TTL_MS) {
                    setHidden(true);
                }
            }
        } catch { /* localStorage unavailable */ }
    }, [adopterId, currentUser, baseEligible]);

    useEffect(() => {
        if (!baseEligible || hidden || !anyVisible || trackedShown || openedRecordType) return;
        zarazTrack('visit_intent_shown', {
            adopter_id: adopterId,
            suppressed_a: showA ? 0 : 1,
            suppressed_b: showB ? 0 : 1,
        });
        setTrackedShown(true);
    }, [baseEligible, hidden, anyVisible, trackedShown, openedRecordType, adopterId, showA, showB]);

    if (!baseEligible || hidden || !anyVisible) return null;

    if (openedRecordType) {
        return (
            <AdoptionFormWizard
                adopterId={adopterId}
                availableAnimals={availableAnimals}
                currentUser={currentUser}
                adopterAddress={adopterAddress}
                initialRecordType={openedRecordType}
                autoOpen
                onClose={() => {
                    setOpenedRecordType(null);
                    setHidden(true);
                }}
            />
        );
    }

    const handleSelect = (intent: IntentType) => {
        zarazTrack('visit_intent_selected', { adopter_id: adopterId, intent_type: intent });
        setOpenedRecordType(intent);
    };

    const handleDismiss = () => {
        try {
            localStorage.setItem(dismissalKey(adopterId, currentUser), String(Date.now()));
        } catch { /* localStorage unavailable */ }
        zarazTrack('visit_intent_dismissed', { adopter_id: adopterId });
        setHidden(true);
    };

    const chips: Array<{ visible: boolean; intent: IntentType; emoji: string; labelKey: 'option_a_short' | 'option_b_short' | 'option_c_short'; titleKey: 'option_a_hint' | 'option_b_hint' | 'option_c_hint' }> = [
        { visible: showA, intent: 'adoption_request', emoji: '📝', labelKey: 'option_a_short', titleKey: 'option_a_hint' },
        { visible: showB, intent: 'adoption', emoji: '🏠', labelKey: 'option_b_short', titleKey: 'option_b_hint' },
        { visible: showC, intent: 'observation', emoji: '👁️', labelKey: 'option_c_short', titleKey: 'option_c_hint' },
    ];

    return (
        <div
            role="region"
            aria-label={t('visitIntent.title')}
            className="rounded-xl border px-3 py-2 mb-3 flex items-center gap-2 sm:gap-3 animate-in fade-in slide-in-from-top-2 duration-300"
            style={{
                background: 'var(--surface-card)',
                borderColor: 'var(--border-default)',
                color: 'var(--text-primary)',
            }}
        >
            <span
                className="hidden sm:inline text-xs font-medium shrink-0"
                style={{ color: 'var(--text-secondary)' }}
            >
                {t('visitIntent.title')}
            </span>

            <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-x-auto sm:overflow-visible">
                {chips.filter(c => c.visible).map((chip, idx) => (
                    <button
                        key={chip.intent}
                        type="button"
                        title={t(`visitIntent.${chip.titleKey}` as never)}
                        aria-label={t(`visitIntent.${chip.titleKey}` as never)}
                        onClick={() => handleSelect(chip.intent)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all duration-200 hover:scale-[1.04] active:scale-[0.97] focus:outline-none focus-visible:ring-2 animate-in fade-in slide-in-from-right-1"
                        style={{
                            background: 'var(--accent-subtle-bg)',
                            color: 'var(--accent-subtle-text)',
                            animationDelay: `${idx * 60}ms`,
                            animationFillMode: 'backwards',
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'var(--accent-badge-bg)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'var(--accent-subtle-bg)';
                        }}
                    >
                        <span aria-hidden="true">{chip.emoji}</span>
                        <span>{t(`visitIntent.${chip.labelKey}` as never)}</span>
                    </button>
                ))}
            </div>

            <button
                type="button"
                onClick={handleDismiss}
                aria-label={t('visitIntent.dismiss')}
                title={t('visitIntent.dismiss')}
                className="shrink-0 p-1 rounded-md transition-opacity opacity-50 hover:opacity-100 focus:outline-none focus-visible:opacity-100"
                style={{ color: 'var(--text-secondary)' }}
            >
                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path strokeLinecap="round" d="M6 6l8 8M14 6l-8 8" />
                </svg>
            </button>
        </div>
    );
}
