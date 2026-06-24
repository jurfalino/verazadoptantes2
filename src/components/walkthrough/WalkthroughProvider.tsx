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

            const SEARCH_STEP = WALKTHROUGH_STEPS.find((s) => s.gate === 'searchRan')!;
            const RESULT_STEPS = WALKTHROUGH_STEPS.filter((s) => !s.gate); // rating, flags, history

            const toDriveStep = (s: WalkthroughStep): DriveStep => ({
                element: s.selector,
                popover: {
                    title: t(s.titleKey),
                    description: t(s.bodyKey),
                    side: s.side,
                    align: s.align,
                    // The search step has no Next — the user types and presses the
                    // real Buscar (both inside the spotlight); the observer advances.
                    ...(s.gate === 'searchRan' ? { showButtons: (['close'] as const).slice() } : {}),
                },
            });

            // Guard so a burst of mutations transitions the tour only once.
            const advanced = { done: false };

            const finishNoResults = () => {
                cleanupObserver();
                toast.info(t('walkthrough.no_results_title'), t('walkthrough.no_results_body'));
                driverRef.current?.destroy();
            };

            // Swap the single search step for the result steps that actually
            // rendered (a result may have no rating badge or no flags). Building
            // the step list from the live DOM avoids skipping absent steps mid-tour.
            const enterResultsPhase = () => {
                const d = driverRef.current;
                if (!d) return;
                const visible = RESULT_STEPS.filter((s) => isVisible(s.selector));
                if (visible.length === 0) { finishNoResults(); return; } // shouldn't happen — history always renders
                d.setSteps(visible.map(toDriveStep)); // soft reset; does NOT fire onDestroyed
                d.moveTo(0);
            };

            // MutationObserver: once the real search completes, advance to the
            // result steps on a result card — or end gracefully on zero results.
            // No coupling into SearchSection's logic (passive markers only).
            const connectObserver = () => {
                cleanupObserver();
                const root = document.getElementById('search-section') || document.body;
                let settle: ReturnType<typeof setTimeout> | null = null;
                const obs = new MutationObserver(() => {
                    if (settle) clearTimeout(settle);
                    settle = setTimeout(() => {
                        const d = driverRef.current;
                        if (!d?.isActive() || advanced.done) return;
                        if (document.querySelector(RESULT_CARD)) { advanced.done = true; cleanupObserver(); enterResultsPhase(); }
                        else if (document.querySelector(RESULTS)) { advanced.done = true; finishNoResults(); } // search ran, zero results
                    }, 450);
                });
                obs.observe(root, { childList: true, subtree: true });
                observerRef.current = obs;
            };

            const d = driver({
                animate: !reduce,
                allowClose: true,
                showProgress: false,
                overlayColor: 'rgba(4, 47, 46, 0.55)',
                popoverClass: 'walkthrough-popover',
                steps: [toDriveStep(SEARCH_STEP)],
                nextBtnText: t('walkthrough.next'),
                prevBtnText: t('walkthrough.back'),
                doneBtnText: t('walkthrough.finish'),
                onDestroyed: () => {
                    cleanupObserver();
                    try { localStorage.setItem(keys.done, '1'); } catch { /* ignore */ }
                    driverRef.current = null;
                },
            });

            driverRef.current = d;
            d.drive();
            // Search phase: focus the input and watch for the real search result.
            document.querySelector<HTMLInputElement>('[data-walkthrough="search-input"]')?.focus();
            connectObserver();
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
