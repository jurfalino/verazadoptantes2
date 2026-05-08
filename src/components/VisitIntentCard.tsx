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
    adopterName?: string | null;
    currentUser: string;
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
 * Visibility matrix: feature flag enabled, current user authenticated, no
 * recent dismissal (per-(adopter, user) localStorage with 7-day TTL), and at
 * least one option not suppressed by recent matching records (30-day window
 * for A and B; C is always available).
 */
export default function VisitIntentCard({ enabled, adopterId, adopterName, currentUser, adoptions, availableAnimals, adopterAddress = '' }: Props) {
    const { t } = useLanguage();
    const [hidden, setHidden] = useState(false);
    const [openedRecordType, setOpenedRecordType] = useState<IntentType | null>(null);
    const [trackedShown, setTrackedShown] = useState(false);

    const baseEligible = enabled && !!currentUser;

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

    const renderIcon = (intent: IntentType) => {
        // 20×20 outline icons, currentColor — render legibly at button text size.
        switch (intent) {
            case 'adoption_request':
                // Speech bubble — adopter asked / requested
                return (
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-4 4v-4H5a2 2 0 0 1-2-2V5z" />
                    </svg>
                );
            case 'adoption':
                // House — adoption completed (animal found a home)
                return (
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 9.5L10 4l7 5.5V16a1 1 0 0 1-1 1h-3v-4H8v4H4a1 1 0 0 1-1-1V9.5z" />
                    </svg>
                );
            case 'observation':
            default:
                // Pencil — write something else
                return (
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 3.5l3 3M4 16l1-3 8.5-8.5 3 3L8 16H4z" />
                    </svg>
                );
        }
    };

    const buttons: Array<{ visible: boolean; intent: IntentType; labelKey: 'option_a' | 'option_b' | 'option_c'; titleKey: 'option_a_hint' | 'option_b_hint' | 'option_c_hint' }> = [
        { visible: showA, intent: 'adoption_request', labelKey: 'option_a', titleKey: 'option_a_hint' },
        { visible: showB, intent: 'adoption', labelKey: 'option_b', titleKey: 'option_b_hint' },
        { visible: showC, intent: 'observation', labelKey: 'option_c', titleKey: 'option_c_hint' },
    ];

    const firstName = (adopterName ?? '').trim().split(/\s+/)[0] || '';
    const subject = firstName || t('visitIntent.title_fallback_subject');
    const titleText = `${t('visitIntent.title_prefix')} ${subject}?`;

    return (
        <div
            role="region"
            aria-label={titleText}
            className="visit-intent-card rounded-xl px-4 py-3 mb-3 flex flex-col gap-3"
            style={{
                background: 'var(--accent-subtle-bg)',
                border: '2px solid var(--accent)',
                color: 'var(--text-primary)',
            }}
        >
            <div className="flex items-center gap-2">
                <span
                    className="text-base font-semibold flex-1 min-w-0"
                    style={{ color: 'var(--accent-strong)' }}
                >
                    {titleText}
                </span>
                <button
                    type="button"
                    onClick={handleDismiss}
                    aria-label={t('visitIntent.dismiss')}
                    title={t('visitIntent.dismiss')}
                    className="shrink-0 p-1 rounded-md transition-opacity opacity-60 hover:opacity-100 focus:outline-none focus-visible:opacity-100"
                    style={{ color: 'var(--accent-strong)' }}
                >
                    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path strokeLinecap="round" d="M6 6l8 8M14 6l-8 8" />
                    </svg>
                </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {buttons.filter(b => b.visible).map((btn) => (
                    <button
                        key={btn.intent}
                        type="button"
                        title={t(`visitIntent.${btn.titleKey}` as never)}
                        aria-label={t(`visitIntent.${btn.labelKey}` as never)}
                        onClick={() => handleSelect(btn.intent)}
                        className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 hover:-translate-y-0.5 active:translate-y-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                        style={{
                            background: 'var(--surface-card)',
                            color: 'var(--accent-strong)',
                            border: '1px solid var(--accent)',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'var(--accent)';
                            e.currentTarget.style.color = '#ffffff';
                            e.currentTarget.style.boxShadow = '0 4px 12px rgba(var(--accent-glow-rgb), 0.25)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'var(--surface-card)';
                            e.currentTarget.style.color = 'var(--accent-strong)';
                            e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)';
                        }}
                    >
                        {renderIcon(btn.intent)}
                        <span className="text-left leading-tight">{t(`visitIntent.${btn.labelKey}` as never)}</span>
                    </button>
                ))}
            </div>
        </div>
    );
}
