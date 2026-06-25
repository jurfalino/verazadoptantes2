'use client';

/**
 * Guided walkthrough (v2.22.x) — a driver.js spotlight tour over the REAL
 * homepage UI. On start it injects three mocked "Juan" records into the live
 * SearchSection (via `demoMatches` on this context — those rows are excluded
 * from every real search EXCEPT here), then spotlights the real search box and
 * the real result cards while the user just clicks Next. driver.js + CSS are
 * lazy-loaded only when the tour starts. The demo data comes from
 * `getWalkthroughDemoMatches()` so the PII masking on the gated cards is real.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Driver, DriveStep } from 'driver.js';
import type { DiscoveryMatch } from '@/app/actions';
import { getWalkthroughDemoMatches } from '@/app/actions/walkthroughDemo';
import { useLanguage } from '@/context/LanguageContext';

interface WalkthroughContextValue {
    enabled: boolean;
    start: () => void;
    /** When non-null, SearchSection renders these as the results for a "Juan" search. */
    demoMatches: DiscoveryMatch[] | null;
}

const WalkthroughContext = createContext<WalkthroughContextValue>({ enabled: false, start: () => {}, demoMatches: null });

export const useWalkthrough = () => useContext(WalkthroughContext);

const keysFor = (email: string | null) => {
    const e = email || 'anon';
    return { pending: `walkthrough_pending_${e}`, done: `walkthrough_done_${e}` };
};

interface StepDef { key: string; element?: string; side: 'top' | 'bottom' | 'left' | 'right'; align: 'start' | 'center' | 'end'; }

// Each step spotlights a REAL element on the page. The card selectors match the
// injected demo cards' hrefs (`/adopter/demo-juan-*`). The last step has no
// element → driver renders a centered popover.
const STEP_DEFS: StepDef[] = [
    { key: 'search', element: '#search', side: 'bottom', align: 'start' },
    { key: 'results', element: '[data-walkthrough="results"]', side: 'top', align: 'center' },
    { key: 'bueno', element: 'a[href*="/adopter/demo-juan-bueno"]', side: 'top', align: 'start' },
    { key: 'protegido', element: 'a[href*="/adopter/demo-juan-bueno"]', side: 'bottom', align: 'start' },
    { key: 'malo', element: 'a[href*="/adopter/demo-juan-malo"]', side: 'top', align: 'start' },
    { key: 'dudoso', element: 'a[href*="/adopter/demo-juan-dudoso"]', side: 'top', align: 'start' },
    { key: 'cierre', side: 'top', align: 'center' },
];

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
    const [demoMatches, setDemoMatches] = useState<DiscoveryMatch[] | null>(null);
    const driverRef = useRef<Driver | null>(null);
    const startingRef = useRef(false);
    const keys = keysFor(userEmail);

    const start = useCallback(async () => {
        if (driverRef.current?.isActive() || startingRef.current) return;
        startingRef.current = true;
        try {
            const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
            const matches = await getWalkthroughDemoMatches();
            const [{ driver }] = await Promise.all([
                import('driver.js'),
                import('driver.js/dist/driver.css'),
                import('./walkthrough.css'),
            ]);

            // Inject the demo records into the real SearchSection ("Juan" + cards).
            setDemoMatches(matches);

            const steps: DriveStep[] = STEP_DEFS.map((s) => ({
                ...(s.element ? { element: s.element } : {}),
                popover: {
                    title: t(`walkthrough.demo_${s.key}_title`),
                    description: t(`walkthrough.demo_${s.key}_body`),
                    side: s.side,
                    align: s.align,
                },
            }));

            const d = driver({
                animate: !reduce,
                allowClose: true,
                disableActiveInteraction: true, // demo cards are inert — user only clicks Next
                showProgress: true,
                progressText: '{{current}} / {{total}}',
                overlayColor: 'rgba(4, 47, 46, 0.55)',
                popoverClass: 'walkthrough-popover',
                steps,
                nextBtnText: t('walkthrough.next'),
                prevBtnText: t('walkthrough.back'),
                doneBtnText: t('walkthrough.finish'),
                onDestroyed: () => {
                    setDemoMatches(null); // restore the real page
                    try { localStorage.setItem(keys.done, '1'); } catch { /* ignore */ }
                    driverRef.current = null;
                },
            });

            driverRef.current = d;
            // Let SearchSection commit the injected "Juan" + cards before spotlighting.
            requestAnimationFrame(() => requestAnimationFrame(() => d.drive()));
        } catch {
            // driver.js failed to load — fail silently (onboarding is non-critical).
            setDemoMatches(null);
            driverRef.current = null;
        } finally {
            startingRef.current = false;
        }
    }, [t, keys.done]);

    // Auto-launch once for genuine new users (pending set by CountryConfirmBanner's
    // new-user path, so flipping the flag on never floods existing users).
    useEffect(() => {
        if (!flagEnabled || !userEmail) return;
        try {
            if (localStorage.getItem('playwright_test_mode') === '1') return; // E2E escape
            if (localStorage.getItem(keys.pending) !== '1') return;
            if (localStorage.getItem(keys.done) === '1') return;
        } catch { return; }
        const timer = setTimeout(() => {
            try { localStorage.removeItem(keys.pending); } catch { /* ignore */ }
            start();
        }, 900);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [flagEnabled, userEmail]);

    // Teardown on unmount.
    useEffect(() => () => { driverRef.current?.destroy(); }, []);

    return (
        <WalkthroughContext.Provider value={{ enabled: flagEnabled, start, demoMatches }}>
            {children}
        </WalkthroughContext.Provider>
    );
}
