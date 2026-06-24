'use client';

/**
 * Guided walkthrough (v2.21.0) — a driver.js spotlight tour that guides a new
 * rescuer to type an adopter's name from memory, run the REAL search, and read
 * the result. driver.js handles the overlay/popover/positioning/keyboard; this
 * provider owns the app-specific logic: the flag/auto-launch, the search-step
 * gate, the MutationObserver that advances on a real search result, and the
 * graceful zero-result / missing-element handling. driver.js + its CSS are
 * lazy-loaded only when the tour starts (kept off the homepage LCP path).
 */

import { createContext, useCallback, useContext, useEffect, useRef } from 'react';
import type { Driver, DriveStep } from 'driver.js';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { WALKTHROUGH_STEPS, walkthroughKeys, type WalkthroughStep } from './steps';

interface WalkthroughContextValue {
    enabled: boolean;
    start: () => void;
}

const WalkthroughContext = createContext<WalkthroughContextValue>({ enabled: false, start: () => {} });

export const useWalkthrough = () => useContext(WalkthroughContext);

const RESULT_CARD = '[data-walkthrough="results"] a[href^="/adopter/"]';
const RESULTS = '[data-walkthrough="results"]';

function isVisible(selector: string): boolean {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.height > 2 && r.width > 2 && el.offsetParent !== null;
}

export function WalkthroughProvider({
    flagEnabled,
    userEmail,
    children,
}: {
    flagEnabled: boolean;
    userEmail: string | null;
    children: React.ReactNode;
}) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const driverRef = useRef<Driver | null>(null);
    const observerRef = useRef<MutationObserver | null>(null);
    const startingRef = useRef(false);
    const keys = walkthroughKeys(userEmail);

    const cleanupObserver = useCallback(() => {
        observerRef.current?.disconnect();
        observerRef.current = null;
    }, []);

    const stepAt = (i: number): WalkthroughStep | undefined => WALKTHROUGH_STEPS[i];

    const start = useCallback(async () => {
        if (driverRef.current?.isActive() || startingRef.current) return;
        startingRef.current = true;
        try {
            const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
            const [{ driver }] = await Promise.all([
                import('driver.js'),
                import('driver.js/dist/driver.css'),
                import('./walkthrough.css'),
            ]);

            const finishNoResults = () => {
                cleanupObserver();
                toast.info(t('walkthrough.no_results_title'), t('walkthrough.no_results_body'));
                driverRef.current?.destroy();
            };

            // MutationObserver: when the search step is active and a search has
            // completed, advance on a result card — or end gracefully if the
            // search returned nothing. No coupling into SearchSection's logic.
            const connectObserver = () => {
                cleanupObserver();
                const root = document.getElementById('search-section') || document.body;
                let settle: ReturnType<typeof setTimeout> | null = null;
                const obs = new MutationObserver(() => {
                    if (settle) clearTimeout(settle);
                    settle = setTimeout(() => {
                        const d = driverRef.current;
                        if (!d?.isActive() || stepAt(d.getActiveIndex() ?? -1)?.id !== 'search') return;
                        if (document.querySelector(RESULT_CARD)) { cleanupObserver(); d.moveNext(); }
                        else if (document.querySelector(RESULTS)) finishNoResults(); // search ran, zero results
                    }, 450);
                });
                obs.observe(root, { childList: true, subtree: true });
                observerRef.current = obs;
            };

            const steps: DriveStep[] = WALKTHROUGH_STEPS.map((s) => ({
                element: s.selector,
                popover: {
                    title: t(s.titleKey),
                    description: t(s.bodyKey),
                    side: s.side,
                    align: s.align,
                    // The search step has no Next — the user types and presses
                    // the real Buscar (both inside the spotlight); the observer
                    // advances. Only the X (close/skip) is offered.
                    showButtons: s.gate === 'searchRan' ? (['close'] as const).slice() : undefined,
                },
            }));

            const d = driver({
                animate: !reduce,
                allowClose: true,
                showProgress: false,
                overlayColor: 'rgba(4, 47, 46, 0.55)',
                popoverClass: 'walkthrough-popover',
                steps,
                nextBtnText: t('walkthrough.next'),
                prevBtnText: t('walkthrough.back'),
                doneBtnText: t('walkthrough.finish'),
                onHighlightStarted: (_el, _step, opts) => {
                    const cur = stepAt(opts.state.activeIndex ?? -1);
                    // Skip a result step whose target isn't present/visible
                    // (e.g. a result with no rating badge or no flags).
                    if (cur && (cur.id === 'rating' || cur.id === 'flags' || cur.id === 'history') && !isVisible(cur.selector)) {
                        opts.driver.moveNext();
                    }
                },
                onHighlighted: (_el, _step, opts) => {
                    const cur = stepAt(opts.state.activeIndex ?? -1);
                    if (cur?.id === 'search') {
                        document.querySelector<HTMLInputElement>('[data-walkthrough="search-input"]')?.focus();
                        connectObserver();
                    } else {
                        cleanupObserver();
                    }
                },
                onDestroyed: () => {
                    cleanupObserver();
                    try { localStorage.setItem(keys.done, '1'); } catch { /* ignore */ }
                    driverRef.current = null;
                },
            });

            driverRef.current = d;
            d.drive();
        } catch {
            // driver.js failed to load — fail silently (onboarding is non-critical)
            cleanupObserver();
            driverRef.current = null;
        } finally {
            startingRef.current = false;
        }
    }, [t, toast, keys.done, cleanupObserver]);

    // Auto-launch once for genuine new users (pending set by CountryConfirmBanner).
    useEffect(() => {
        if (!flagEnabled || !userEmail) return;
        let testMode = false;
        try {
            testMode = localStorage.getItem('playwright_test_mode') === '1';
            if (testMode) return;
            if (localStorage.getItem(keys.pending) !== '1') return;
            if (localStorage.getItem(keys.done) === '1') return;
        } catch { return; }
        // Delay so the page (and the country-confirm banner) settles first.
        const timer = setTimeout(() => {
            try { localStorage.removeItem(keys.pending); } catch { /* ignore */ }
            start();
        }, 900);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [flagEnabled, userEmail]);

    // Teardown on unmount
    useEffect(() => () => { cleanupObserver(); driverRef.current?.destroy(); }, [cleanupObserver]);

    return (
        <WalkthroughContext.Provider value={{ enabled: flagEnabled, start }}>
            {children}
        </WalkthroughContext.Provider>
    );
}
