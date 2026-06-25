'use client';

/**
 * Guided walkthrough (v2.22.x) — a driver.js spotlight tour over the REAL
 * homepage UI. It reveals progressively: empty search box → "Juan" typed →
 * results appear → spotlight each real card, advancing on Next. The three
 * mocked "Juan" records are injected into the LIVE SearchSection via this
 * context (`demoQuery` + `demoResults`); those `isDemo` rows are excluded from
 * every real search EXCEPT here. driver.js + CSS are lazy-loaded on start.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Driver, DriveStep } from 'driver.js';
import type { DiscoveryMatch } from '@/app/actions';
import { getWalkthroughDemoMatches } from '@/app/actions/walkthroughDemo';
import { useLanguage } from '@/context/LanguageContext';

interface WalkthroughContextValue {
    enabled: boolean;
    start: () => void;
    /** True while the tour is running — SearchSection takes over query/results. */
    demoActive: boolean;
    /** What the real search box should show ('' empty, then 'Juan'). */
    demoQuery: string;
    /** Demo results to render in the real list (null until the "results" step). */
    demoResults: DiscoveryMatch[] | null;
}

const WalkthroughContext = createContext<WalkthroughContextValue>({
    enabled: false, start: () => {}, demoActive: false, demoQuery: '', demoResults: null,
});

export const useWalkthrough = () => useContext(WalkthroughContext);

const keysFor = (email: string | null) => {
    const e = email || 'anon';
    return { pending: `walkthrough_pending_${e}`, done: `walkthrough_done_${e}` };
};

interface StepDef { key: string; element?: string; side: 'top' | 'bottom' | 'left' | 'right'; align: 'start' | 'center' | 'end'; }

// Each step spotlights a REAL element. Steps 0–1 show the search box (empty,
// then "Juan"); step 2 reveals the results; 3–6 are the real cards (matched by
// the injected demo hrefs); the last has no element → centered popover.
const STEP_DEFS: StepDef[] = [
    { key: 'search', element: '#search', side: 'bottom', align: 'start' },
    { key: 'typed', element: '#search', side: 'bottom', align: 'start' },
    { key: 'results', element: '[data-walkthrough="results"]', side: 'top', align: 'center' },
    { key: 'bueno', element: 'a[href*="/adopter/demo-juan-bueno"]', side: 'top', align: 'start' },
    { key: 'protegido', element: 'a[href*="/adopter/demo-juan-bueno"]', side: 'bottom', align: 'start' },
    { key: 'malo', element: 'a[href*="/adopter/demo-juan-malo"]', side: 'top', align: 'start' },
    { key: 'dudoso', element: 'a[href*="/adopter/demo-juan-dudoso"]', side: 'top', align: 'start' },
    { key: 'cierre', side: 'top', align: 'center' },
];

const TYPED_FROM = 1;   // step index at which the box shows "Juan"
const RESULTS_FROM = 2; // step index at which the result cards appear

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
    const [demoActive, setDemoActive] = useState(false);
    const [demoQuery, setDemoQuery] = useState('');
    const [demoResults, setDemoResults] = useState<DiscoveryMatch[] | null>(null);
    const matchesRef = useRef<DiscoveryMatch[]>([]);
    const driverRef = useRef<Driver | null>(null);
    const startingRef = useRef(false);
    const keys = keysFor(userEmail);

    // Set the injected state for the step about to be shown (progressive reveal).
    const applyPhase = useCallback((idx: number) => {
        setDemoQuery(idx >= TYPED_FROM ? 'Juan' : '');
        setDemoResults(idx >= RESULTS_FROM ? matchesRef.current : null);
    }, []);

    const start = useCallback(async () => {
        if (driverRef.current?.isActive() || startingRef.current) return;
        startingRef.current = true;
        try {
            const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
            matchesRef.current = await getWalkthroughDemoMatches();
            const [{ driver }] = await Promise.all([
                import('driver.js'),
                import('driver.js/dist/driver.css'),
                import('./walkthrough.css'),
            ]);

            // Enter the tour at the empty-box phase.
            setDemoActive(true);
            applyPhase(0);

            const steps: DriveStep[] = STEP_DEFS.map((s) => ({
                ...(s.element ? { element: s.element } : {}),
                popover: {
                    title: t(`walkthrough.demo_${s.key}_title`),
                    description: t(`walkthrough.demo_${s.key}_body`),
                    side: s.side,
                    align: s.align,
                },
            }));

            // We drive Next/Prev ourselves so we can stage the reveal and let the
            // newly-revealed element (the results container) render before driver
            // tries to spotlight it.
            const advance = (target: number, needsRender: boolean) => {
                applyPhase(target);
                const go = () => driverRef.current?.moveTo(target);
                if (needsRender) requestAnimationFrame(() => requestAnimationFrame(go));
                else go();
            };

            const d = driver({
                animate: !reduce,
                allowClose: true,
                disableActiveInteraction: true, // demo cards are inert — user only clicks Next
                showProgress: true,
                progressText: '{{current}} / {{total}}',
                overlayColor: 'rgba(8, 11, 20, 0.72)',
                popoverClass: 'walkthrough-popover',
                steps,
                nextBtnText: t('walkthrough.next'),
                prevBtnText: t('walkthrough.back'),
                doneBtnText: t('walkthrough.finish'),
                onNextClick: () => {
                    const cur = driverRef.current?.getActiveIndex() ?? 0;
                    if (cur >= STEP_DEFS.length - 1) { driverRef.current?.destroy(); return; }
                    advance(cur + 1, cur + 1 === RESULTS_FROM);
                },
                onPrevClick: () => {
                    const cur = driverRef.current?.getActiveIndex() ?? 0;
                    if (cur <= 0) return;
                    advance(cur - 1, false);
                },
                onDestroyed: () => {
                    setDemoActive(false);
                    setDemoQuery('');
                    setDemoResults(null);
                    try { localStorage.setItem(keys.done, '1'); } catch { /* ignore */ }
                    driverRef.current = null;
                },
            });

            driverRef.current = d;
            // Let SearchSection commit the empty "Juan" box before spotlighting.
            requestAnimationFrame(() => requestAnimationFrame(() => d.drive()));
        } catch {
            setDemoActive(false);
            setDemoQuery('');
            setDemoResults(null);
            driverRef.current = null;
        } finally {
            startingRef.current = false;
        }
    }, [t, keys.done, applyPhase]);

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
        <WalkthroughContext.Provider value={{ enabled: flagEnabled, start, demoActive, demoQuery, demoResults }}>
            {children}
        </WalkthroughContext.Provider>
    );
}
