'use client';

/**
 * Guided walkthrough (v2.22.x) — a driver.js spotlight tour over the REAL
 * homepage UI. It reveals progressively: empty search box → "Juan" typed →
 * results appear → spotlight each real card → THEN it re-searches "Juan + the
 * phone of Juan BuenAdoptante" and shows that gated record's contact becoming
 * revealed (the search-match reveal, demonstrated live). The three mocked
 * records are injected into the live SearchSection via this context; those
 * `isDemo` rows are excluded from every real search EXCEPT here.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Driver, DriveStep } from 'driver.js';
import type { DiscoveryMatch } from '@/app/actions';
import { getWalkthroughDemoMatches, getWalkthroughDemoRevealed } from '@/app/actions/walkthroughDemo';
import { deserializeContactEntries } from '@/lib/contactEntries';
import { useLanguage } from '@/context/LanguageContext';

interface WalkthroughContextValue {
    enabled: boolean;
    start: () => void;
    demoActive: boolean;
    demoQuery: string;
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

const REVEAL_ID = 'demo-juan-bueno';

interface StepDef { key: string; element?: string; side: 'top' | 'bottom' | 'left' | 'right'; align: 'start' | 'center' | 'end'; }

// Each step spotlights a REAL element. 0–1 the search box (empty, then "Juan");
// 2 reveals the results; 3–6 the cards; 7 adds the phone to the box; 8 shows
// BuenAdoptante revealed; 9 (no element) is the centered close.
const STEP_DEFS: StepDef[] = [
    { key: 'search', element: '#search', side: 'bottom', align: 'start' },
    { key: 'typed', element: '#search', side: 'bottom', align: 'start' },
    { key: 'results', element: '[data-walkthrough="results"]', side: 'top', align: 'center' },
    { key: 'bueno', element: 'a[href*="/adopter/demo-juan-bueno"]', side: 'top', align: 'start' },
    { key: 'protegido', element: 'a[href*="/adopter/demo-juan-bueno"]', side: 'bottom', align: 'start' },
    { key: 'malo', element: 'a[href*="/adopter/demo-juan-malo"]', side: 'top', align: 'start' },
    { key: 'dudoso', element: 'a[href*="/adopter/demo-juan-dudoso"]', side: 'top', align: 'start' },
    { key: 'revealphone', element: '#search', side: 'bottom', align: 'start' },
    { key: 'revealresult', element: 'a[href*="/adopter/demo-juan-bueno"]', side: 'bottom', align: 'start' },
    { key: 'cierre', side: 'top', align: 'center' },
];

const TYPED_FROM = 1;          // box shows "Juan"
const RESULTS_FROM = 2;        // result cards appear (masked)
const REVEAL_PHONE_FROM = 7;   // box shows "Juan <phone>"
const REVEAL_RESULTS_FROM = 8; // BuenAdoptante renders revealed
// Steps where the spotlight target's presence/content depends on a fresh render.
const needsRender = (idx: number) => idx === RESULTS_FROM || idx === REVEAL_RESULTS_FROM;

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
    const matchesRef = useRef<DiscoveryMatch[]>([]);       // masked
    const revealRef = useRef<DiscoveryMatch[]>([]);        // BuenAdoptante unmasked
    const revealQueryRef = useRef<string>('Juan');         // "Juan <phone>"
    const driverRef = useRef<Driver | null>(null);
    const startingRef = useRef(false);
    const keys = keysFor(userEmail);

    // Set the injected state for the step about to be shown (progressive reveal,
    // then the phone-search reveal).
    const applyPhase = useCallback((idx: number) => {
        setDemoQuery(idx >= REVEAL_PHONE_FROM ? revealQueryRef.current : (idx >= TYPED_FROM ? 'Juan' : ''));
        setDemoResults(idx >= REVEAL_RESULTS_FROM ? revealRef.current : (idx >= RESULTS_FROM ? matchesRef.current : null));
    }, []);

    const start = useCallback(async () => {
        if (driverRef.current?.isActive() || startingRef.current) return;
        startingRef.current = true;
        try {
            const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
            const [normal, revealed] = await Promise.all([
                getWalkthroughDemoMatches(),
                getWalkthroughDemoRevealed(),
            ]);
            matchesRef.current = normal;
            revealRef.current = revealed;
            // Build the "Juan <phone>" query from the revealed record's real phone
            // (so it reflects any admin edit, not a hardcoded value).
            const bueno = revealed.find(m => m.adopterId === REVEAL_ID);
            const phone = bueno
                ? deserializeContactEntries(bueno.adopter.contactEntries).find(e => e.type === 'phone')?.value ?? ''
                : '';
            revealQueryRef.current = phone ? `Juan ${phone}` : 'Juan';

            const [{ driver }] = await Promise.all([
                import('driver.js'),
                import('driver.js/dist/driver.css'),
                import('./walkthrough.css'),
            ]);

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

            const advance = (target: number) => {
                applyPhase(target);
                const go = () => driverRef.current?.moveTo(target);
                if (needsRender(target)) requestAnimationFrame(() => requestAnimationFrame(go));
                else go();
            };

            const d = driver({
                animate: !reduce,
                allowClose: true,
                disableActiveInteraction: true,
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
                    advance(cur + 1);
                },
                onPrevClick: () => {
                    const cur = driverRef.current?.getActiveIndex() ?? 0;
                    if (cur <= 0) return;
                    advance(cur - 1);
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

    useEffect(() => () => { driverRef.current?.destroy(); }, []);

    return (
        <WalkthroughContext.Provider value={{ enabled: flagEnabled, start, demoActive, demoQuery, demoResults }}>
            {children}
        </WalkthroughContext.Provider>
    );
}
