'use client';

/**
 * Guided-walkthrough demo (v2.22.0). A self-contained, click-Next modal that
 * teaches the core habit — search an adopter before you hand over an animal —
 * over three mocked "Juan" records (BuenAdoptante / MalAdoptante / Dudoso).
 *
 * No live-DOM coupling, no driver.js: the modal owns its surface, renders the
 * real <AdopterResultCard> against `getWalkthroughDemoMatches()` (so the PII
 * masking on the gated cards is genuine), and steps through narration with a
 * Next button. Each step optionally focuses one card (ring + dim the others).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiscoveryMatch } from '@/app/actions';
import { getWalkthroughDemoMatches } from '@/app/actions/walkthroughDemo';
import { AdopterResultCard } from '@/components/AdopterResultCard';
import { useLanguage } from '@/context/LanguageContext';

interface DemoStep {
    key: string;
    /** Card index to focus (ring + dim others), or null for "all / none". */
    focus: number | null;
}

const STEPS: DemoStep[] = [
    { key: 'search', focus: null },
    { key: 'results', focus: null },
    { key: 'bueno', focus: 0 },
    { key: 'protegido', focus: 0 },
    { key: 'malo', focus: 1 },
    { key: 'dudoso', focus: 2 },
    { key: 'cierre', focus: null },
];

export function WalkthroughDemoModal({
    open,
    onClose,
    isAuthenticated,
}: {
    open: boolean;
    onClose: () => void;
    isAuthenticated: boolean;
}) {
    const { t } = useLanguage();
    const [matches, setMatches] = useState<DiscoveryMatch[] | null>(null);
    const [step, setStep] = useState(0);
    const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

    // Fetch the mocked records once when the modal opens; reset to step 0.
    useEffect(() => {
        if (!open) return;
        setStep(0);
        let cancelled = false;
        getWalkthroughDemoMatches()
            .then(m => { if (!cancelled) setMatches(m); })
            .catch(() => { if (!cancelled) setMatches([]); });
        return () => { cancelled = true; };
    }, [open]);

    const close = useCallback(() => { onClose(); }, [onClose]);

    // Esc to close.
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, close]);

    const cur = STEPS[step];

    // Scroll the focused card into view within the modal body on step change.
    useEffect(() => {
        if (!open || cur.focus === null) return;
        cardRefs.current[cur.focus]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, [open, step, cur.focus]);

    if (!open) return null;

    const isLast = step === STEPS.length - 1;
    const showCards = step >= 1;

    return (
        <div
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-label={t('walkthrough.modal_title')}
            onClick={close}
        >
            <div
                className="w-full max-w-md bg-stone-50 rounded-2xl shadow-2xl flex flex-col max-h-[88vh] overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 bg-white flex-shrink-0">
                    <span className="text-sm font-semibold text-stone-800">{t('walkthrough.modal_title')}</span>
                    <button
                        onClick={close}
                        aria-label={t('walkthrough.finish')}
                        className="text-stone-400 hover:text-stone-700 transition-colors"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                </div>

                {/* Mock search bar */}
                <div className="px-4 pt-4 flex-shrink-0">
                    <div className={`flex gap-2 items-center rounded-xl border bg-white px-3 py-2 transition-all ${step === 0 ? 'border-teal-400 ring-2 ring-teal-200' : 'border-stone-200'}`}>
                        <svg className="w-4 h-4 text-stone-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" /></svg>
                        <span className="flex-1 text-sm text-stone-800 font-medium">Juan</span>
                        <span className="text-xs font-semibold text-white bg-teal-600 rounded-lg px-3 py-1">{t('walkthrough.search_button')}</span>
                    </div>
                </div>

                {/* Cards */}
                <div className="px-4 py-4 space-y-3 overflow-y-auto flex-1">
                    {!matches ? (
                        <div className="flex justify-center py-10 text-stone-400 text-sm">…</div>
                    ) : showCards ? (
                        matches.map((m, i) => {
                            const dim = cur.focus !== null && cur.focus !== i;
                            const focused = cur.focus === i;
                            return (
                                <div
                                    key={m.adopterId}
                                    ref={el => { cardRefs.current[i] = el; }}
                                    className={`rounded-xl transition-all duration-300 ${dim ? 'opacity-40' : 'opacity-100'} ${focused ? 'ring-2 ring-teal-400 ring-offset-2 ring-offset-stone-50' : ''}`}
                                >
                                    <AdopterResultCard match={m} isAuthenticated={isAuthenticated} showMetadata />
                                </div>
                            );
                        })
                    ) : (
                        <div className="flex justify-center py-10 text-stone-400 text-sm italic">
                            {t('walkthrough.demo_search_body')}
                        </div>
                    )}
                </div>

                {/* Narration + nav */}
                <div className="px-4 py-4 border-t border-stone-200 bg-white flex-shrink-0">
                    <h3 className="text-base font-bold text-stone-900 mb-1">{t(`walkthrough.demo_${cur.key}_title`)}</h3>
                    <p className="text-sm text-stone-600 leading-relaxed">{t(`walkthrough.demo_${cur.key}_body`)}</p>
                    <div className="flex items-center justify-between mt-4">
                        <div className="flex gap-1.5">
                            {STEPS.map((_, i) => (
                                <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? 'w-5 bg-teal-600' : 'w-1.5 bg-stone-300'}`} />
                            ))}
                        </div>
                        <div className="flex gap-2">
                            {step > 0 && (
                                <button
                                    onClick={() => setStep(s => Math.max(0, s - 1))}
                                    className="px-3 py-1.5 text-sm font-medium text-stone-600 hover:text-stone-900 transition-colors"
                                >
                                    {t('walkthrough.back')}
                                </button>
                            )}
                            <button
                                onClick={() => (isLast ? close() : setStep(s => Math.min(STEPS.length - 1, s + 1)))}
                                className="px-4 py-1.5 text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors"
                            >
                                {isLast ? t('walkthrough.finish') : t('walkthrough.next')}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
