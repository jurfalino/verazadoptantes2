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
 * Inline prompt that appears at the top of the Adoptions section on adopter
 * profiles, asking the visiting user why they're here and routing them to
 * the matching wizard with the recordType pre-selected.
 *
 * Visibility matrix (all must be true): feature flag enabled, not the profile
 * owner, current user authenticated, no recent dismissal (7d TTL), at least
 * one of the three options not suppressed by recent matching records (30d).
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

    // Read dismissal flag on mount
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
        } catch { /* localStorage unavailable (private-mode browsers) — show as default */ }
    }, [adopterId, currentUser, baseEligible]);

    // Telemetry: fire shown event once when card actually renders
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

    // When an option is picked, render the wizard pre-bound to that recordType.
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
                    // The card has done its job; don't re-prompt for this profile in this session.
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
        } catch { /* localStorage unavailable; dismissal is per-mount only */ }
        zarazTrack('visit_intent_dismissed', { adopter_id: adopterId });
        setHidden(true);
    };

    return (
        <div
            role="region"
            aria-label={t('visitIntent.title') || 'Why are you visiting?'}
            className="rounded-xl border px-4 py-4 mb-4 relative"
            style={{
                background: 'var(--status-info-bg)',
                borderColor: 'var(--status-info-border)',
                color: 'var(--status-info-text)',
            }}
        >
            <button
                type="button"
                onClick={handleDismiss}
                aria-label={t('visitIntent.dismiss') || 'Dismiss'}
                className="absolute top-2 right-2 p-1.5 rounded-md hover:opacity-70 transition-opacity"
            >
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path strokeLinecap="round" d="M6 6l8 8M14 6l-8 8" />
                </svg>
            </button>

            <p className="text-sm font-semibold mb-3 pr-8">
                {t('visitIntent.title')}
            </p>

            <div className="flex flex-col gap-2">
                {showA && (
                    <button
                        type="button"
                        onClick={() => handleSelect('adoption_request')}
                        className="text-left rounded-lg px-3 py-2.5 bg-white/70 hover:bg-white border border-current/10 hover:border-current/20 transition-colors"
                    >
                        <span className="flex items-center gap-2">
                            <span className="text-base shrink-0" aria-hidden="true">📝</span>
                            <span className="flex-1">
                                <span className="block text-sm font-semibold">{t('visitIntent.option_a')}</span>
                                <span className="block text-xs opacity-75">{t('visitIntent.option_a_hint')}</span>
                            </span>
                        </span>
                    </button>
                )}

                {showB && (
                    <button
                        type="button"
                        onClick={() => handleSelect('adoption')}
                        className="text-left rounded-lg px-3 py-2.5 bg-white/70 hover:bg-white border border-current/10 hover:border-current/20 transition-colors"
                    >
                        <span className="flex items-center gap-2">
                            <span className="text-base shrink-0" aria-hidden="true">🏠</span>
                            <span className="flex-1">
                                <span className="block text-sm font-semibold">{t('visitIntent.option_b')}</span>
                                <span className="block text-xs opacity-75">{t('visitIntent.option_b_hint')}</span>
                            </span>
                        </span>
                    </button>
                )}

                {showC && (
                    <button
                        type="button"
                        onClick={() => handleSelect('observation')}
                        className="text-left rounded-lg px-3 py-2.5 bg-white/70 hover:bg-white border border-current/10 hover:border-current/20 transition-colors"
                    >
                        <span className="flex items-center gap-2">
                            <span className="text-base shrink-0" aria-hidden="true">👁️</span>
                            <span className="flex-1">
                                <span className="block text-sm font-semibold">{t('visitIntent.option_c')}</span>
                                <span className="block text-xs opacity-75">{t('visitIntent.option_c_hint')}</span>
                            </span>
                        </span>
                    </button>
                )}
            </div>

            <button
                type="button"
                onClick={handleDismiss}
                className="mt-3 text-xs underline opacity-75 hover:opacity-100 transition-opacity"
            >
                {t('visitIntent.dismiss')}
            </button>
        </div>
    );
}
