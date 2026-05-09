'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { zarazTrack } from '@/lib/zaraz';
import AdoptionFormWizard from './AdoptionFormWizard';

type IntentType = 'adoption' | 'adoption_request' | 'observation' | 'follow_up' | 'returned_pet';
type IconKind = IntentType | 'other';
type View = 'main' | 'other';

interface AdoptionLite {
    addedBy?: string | null;
    recordType?: string | null;
    date?: number | Date | string | null;
}

interface Props {
    adopterId: string;
    adopterName?: string | null;
    currentUser: string;
    adoptions: AdoptionLite[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    availableAnimals?: any[];
    adopterAddress?: string;
    /**
     * Called when the card transitions from rendered to hidden (currently:
     * after the launched wizard closes). Lets the parent un-suppress sibling
     * UI like the standalone "Registrar actividad" CTA.
     */
    onHide?: () => void;
}

const ALREADY_ACTED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

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
 * Prominent prompt rendered above the activity section. Uses theme CSS
 * variables only (works under any [data-theme] palette) and animates in on
 * mount. The card asks the visitor's intent and routes to the matching wizard
 * with the recordType pre-selected.
 *
 * Visibility matrix: current user authenticated, and at least one option not
 * suppressed by recent matching records (30-day window for A and B; C is
 * always available). The card stays visible until the user picks an option
 * AND closes the resulting wizard — there is no manual dismiss; the prompt
 * is intentionally sticky.
 */
export default function VisitIntentCard({ adopterId, adopterName, currentUser, adoptions, availableAnimals, adopterAddress = '', onHide }: Props) {
    const { t } = useLanguage();
    const [hidden, setHidden] = useState(false);
    const [openedRecordType, setOpenedRecordType] = useState<IntentType | null>(null);
    const [trackedShown, setTrackedShown] = useState(false);
    const [view, setView] = useState<View>('main');

    const baseEligible = !!currentUser;

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
                adopterAdoptions={adoptions}
                currentUser={currentUser}
                adopterAddress={adopterAddress}
                initialRecordType={openedRecordType}
                autoOpen
                onClose={() => {
                    setOpenedRecordType(null);
                    setHidden(true);
                    onHide?.();
                }}
            />
        );
    }

    const handleSelect = (intent: IntentType) => {
        zarazTrack('visit_intent_selected', { adopter_id: adopterId, intent_type: intent });
        setOpenedRecordType(intent);
    };

    const renderIcon = (kind: IconKind) => {
        // 20×20 outline icons, currentColor — render legibly at button text size.
        switch (kind) {
            case 'adoption_request':
                // Speech bubble — adopter asked / requested
                return (
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-4 4v-4H5a2 2 0 0 1-2-2V5z" />
                    </svg>
                );
            case 'adoption':
                // House — adoption completed
                return (
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 9.5L10 4l7 5.5V16a1 1 0 0 1-1 1h-3v-4H8v4H4a1 1 0 0 1-1-1V9.5z" />
                    </svg>
                );
            case 'other':
                // Three-dot ellipsis — "more options"
                return (
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <circle cx="5" cy="10" r="1.4" />
                        <circle cx="10" cy="10" r="1.4" />
                        <circle cx="15" cy="10" r="1.4" />
                    </svg>
                );
            case 'follow_up':
                // Phone receiver — follow-up call
                return (
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4.5C4 3.67 4.67 3 5.5 3H7.7l1.2 3.4-1.7 1A9 9 0 0 0 12.6 12l1-1.7 3.4 1.2v2.2c0 .83-.67 1.5-1.5 1.5C8.5 15.2 4 10.7 4 4.5z" />
                    </svg>
                );
            case 'returned_pet':
                // U-turn arrow — pet returned
                return (
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7 12L3 8l4-4M3 8h9a4.5 4.5 0 0 1 0 9H8" />
                    </svg>
                );
            case 'observation':
            default:
                // Note / document with lines
                return (
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 3h7l3 3v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M12 3v3h3 M7 9h6 M7 12h6 M7 15h4" />
                    </svg>
                );
        }
    };

    type ButtonDef = {
        intent: IntentType | 'other';
        labelKey: 'option_a' | 'option_b' | 'option_c' | 'option_followup' | 'option_returned' | 'option_observation';
        titleKey: 'option_a_hint' | 'option_b_hint' | 'option_c_hint' | 'option_followup_hint' | 'option_returned_hint' | 'option_observation_hint';
    };

    const mainButtons: Array<ButtonDef & { visible: boolean }> = [
        { visible: showA, intent: 'adoption_request', labelKey: 'option_a', titleKey: 'option_a_hint' },
        { visible: showB, intent: 'adoption', labelKey: 'option_b', titleKey: 'option_b_hint' },
        { visible: showC, intent: 'other', labelKey: 'option_c', titleKey: 'option_c_hint' },
    ];

    const otherButtons: ButtonDef[] = [
        { intent: 'follow_up', labelKey: 'option_followup', titleKey: 'option_followup_hint' },
        { intent: 'returned_pet', labelKey: 'option_returned', titleKey: 'option_returned_hint' },
        { intent: 'observation', labelKey: 'option_observation', titleKey: 'option_observation_hint' },
    ];

    const visibleButtons: ButtonDef[] = view === 'main'
        ? mainButtons.filter(b => b.visible)
        : otherButtons;

    const firstName = (adopterName ?? '').trim().split(/\s+/)[0] || '';
    const subject = firstName || t('visitIntent.title_fallback_subject');
    const titleText = `${t('visitIntent.title_prefix')} ${subject}?`;

    const handleButtonClick = (intent: IntentType | 'other') => {
        if (intent === 'other') {
            zarazTrack('visit_intent_other_opened', { adopter_id: adopterId });
            setView('other');
            return;
        }
        handleSelect(intent);
    };

    const handleBack = () => setView('main');

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
                    style={{ color: 'var(--accent)' }}
                >
                    {titleText}
                </span>
            </div>

            <div key={view} className="flex flex-col sm:flex-row gap-2 animate-slideDown">
                {view === 'other' && (
                    <button
                        type="button"
                        onClick={handleBack}
                        aria-label={t('visitIntent.back')}
                        title={t('visitIntent.back')}
                        className="inline-flex items-center justify-center gap-1.5 sm:gap-0 sm:w-9 px-3 py-2 sm:px-0 rounded-lg text-sm font-medium transition-all duration-150 hover:-translate-y-0.5 active:translate-y-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 shrink-0"
                        style={{
                            background: 'transparent',
                            color: 'var(--accent)',
                            border: '1px solid var(--accent)',
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'var(--accent)';
                            e.currentTarget.style.color = '#ffffff';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent';
                            e.currentTarget.style.color = 'var(--accent)';
                        }}
                    >
                        <svg className="w-4 h-4 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4l-6 6 6 6" />
                        </svg>
                        <span className="sm:hidden">{t('visitIntent.back')}</span>
                    </button>
                )}
                {visibleButtons.map((btn) => (
                    <button
                        key={btn.intent}
                        type="button"
                        title={t(`visitIntent.${btn.titleKey}` as never)}
                        aria-label={t(`visitIntent.${btn.labelKey}` as never)}
                        onClick={() => handleButtonClick(btn.intent)}
                        className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 hover:-translate-y-0.5 active:translate-y-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 flex-1 min-w-0"
                        style={{
                            background: 'var(--surface-card)',
                            color: 'var(--accent)',
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
                            e.currentTarget.style.color = 'var(--accent)';
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
