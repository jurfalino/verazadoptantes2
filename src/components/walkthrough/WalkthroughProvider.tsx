'use client';

/**
 * Guided walkthrough (v2.22.x) — a driver.js spotlight tour over the REAL
 * homepage UI. Flow: empty search box → "Juan" typed (type effect) → results
 * appear → spotlight each card → "is it one of these?" → then the power tip:
 * append Juan BuenAdoptante's phone to the search (type effect), the result set
 * narrows to the ONE matching record, and its phone reveals in place. The mocked
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

// 0–1 the search box (empty, then "Juan"); 2 reveals the 3 results; 3–6 the
// cards; 7 the "is it one of these?" decision (centered); 8 appends the phone to
// the box; 9 shows the ONE matching record with its phone revealed (finale).
const STEP_DEFS: StepDef[] = [
    { key: 'search', element: '#search', side: 'bottom', align: 'start' },
    { key: 'typed', element: '#search', side: 'bottom', align: 'start' },
    { key: 'results', element: '[data-walkthrough="results"]', side: 'top', align: 'center' },
    { key: 'bueno', element: 'a[href*="/adopter/demo-juan-bueno"]', side: 'top', align: 'start' },
    { key: 'protegido', element: 'a[href*="/adopter/demo-juan-bueno"]', side: 'bottom', align: 'start' },
    { key: 'malo', element: 'a[href*="/adopter/demo-juan-malo"]', side: 'top', align: 'start' },
    { key: 'dudoso', element: 'a[href*="/adopter/demo-juan-dudoso"]', side: 'top', align: 'start' },
    { key: 'cierre', element: '[data-walkthrough="create-new"]', side: 'top', align: 'center' },
    { key: 'revealphone', element: '#search', side: 'bottom', align: 'start' },
    { key: 'revealresult', element: 'a[href*="/adopter/demo-juan-bueno"]', side: 'bottom', align: 'start' },
];

const TYPED_FROM = 1;           // box shows "Juan"
const RESULTS_FROM = 2;         // the 3 (masked) result cards appear
const REVEAL_PHONE_FROM = 8;    // box shows "Juan <phone>"
const REVEAL_RESULTS_FROM = 9;  // narrowed to the one matching record, revealed
// Steps where the spotlight target's presence/content depends on a fresh render.
const needsRender = (idx: number) => idx === RESULTS_FROM || idx === REVEAL_RESULTS_FROM;
// Steps where the query is "typed in" with an animation (forward only).
const isTypeStep = (idx: number) => idx === TYPED_FROM || idx === REVEAL_PHONE_FROM;

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
    const matchesRef = useRef<DiscoveryMatch[]>([]);   // the 3, masked
    const revealRef = useRef<DiscoveryMatch[]>([]);    // ONLY BuenAdoptante, phone revealed
    const revealQueryRef = useRef<string>('Juan');     // "Juan <phone>"
    const driverRef = useRef<Driver | null>(null);
    const startingRef = useRef(false);
    const typingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const keys = keysFor(userEmail);

    const clearTyping = useCallback(() => {
        if (typingRef.current) { clearTimeout(typingRef.current); typingRef.current = null; }
    }, []);

    // Fast type-in effect: animate `to` from `fromLen` chars to its full length.
    const typeQuery = useCallback((to: string, fromLen: number) => {
        clearTyping();
        setDemoQuery(to.slice(0, fromLen));
        let i = fromLen;
        const tick = () => {
            i++;
            setDemoQuery(to.slice(0, i));
            if (i < to.length) typingRef.current = setTimeout(tick, 45);
            else typingRef.current = null;
        };
        if (fromLen < to.length) typingRef.current = setTimeout(tick, 160);
        else setDemoQuery(to);
    }, [clearTyping]);

    const start = useCallback(async () => {
        if (driverRef.current?.isActive() || startingRef.current) return;
        startingRef.current = true;
        try {
            const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
            // Theme-aware overlay: a dark page has almost no luminance to remove,
            // so in dark mode push the veil to near-pure-black at higher opacity
            // (snuffs the page's residual blue glow). Light keeps a softer veil.
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            const overlayColor = isDark ? 'rgba(0, 0, 0, 0.86)' : 'rgba(8, 11, 20, 0.68)';
            const [normal, revealedAll] = await Promise.all([
                getWalkthroughDemoMatches(),
                getWalkthroughDemoRevealed(),
            ]);
            matchesRef.current = normal;
            // The phone-search narrows to the ONE record whose phone matched.
            revealRef.current = revealedAll.filter(m => m.adopterId === REVEAL_ID);
            const bueno = revealedAll.find(m => m.adopterId === REVEAL_ID);
            const phone = bueno
                ? deserializeContactEntries(bueno.adopter.contactEntries).find(e => e.type === 'phone')?.value ?? ''
                : '';
            revealQueryRef.current = phone ? `Juan ${phone}` : 'Juan';

            const [{ driver }] = await Promise.all([
                import('driver.js'),
                import('driver.js/dist/driver.css'),
                import('./walkthrough.css'),
            ]);

            const queryFor = (idx: number) =>
                idx >= REVEAL_PHONE_FROM ? revealQueryRef.current : (idx >= TYPED_FROM ? 'Juan' : '');
            const resultsFor = (idx: number): DiscoveryMatch[] | null =>
                idx >= REVEAL_RESULTS_FROM ? revealRef.current : (idx >= RESULTS_FROM ? matchesRef.current : null);

            setDemoActive(true);
            setDemoQuery('');
            setDemoResults(null);

            const steps: DriveStep[] = STEP_DEFS.map((s) => ({
                ...(s.element ? { element: s.element } : {}),
                popover: {
                    title: t(`walkthrough.demo_${s.key}_title`),
                    description: t(`walkthrough.demo_${s.key}_body`),
                    side: s.side,
                    align: s.align,
                },
            }));

            const advance = (target: number, forward: boolean) => {
                clearTyping();
                setDemoResults(resultsFor(target));
                const go = () => {
                    driverRef.current?.moveTo(target);
                    if (forward && isTypeStep(target)) {
                        // type "Juan" from empty, or append the phone after "Juan"
                        typeQuery(queryFor(target), target === TYPED_FROM ? 0 : 'Juan'.length);
                    } else {
                        setDemoQuery(queryFor(target));
                    }
                };
                if (needsRender(target)) requestAnimationFrame(() => requestAnimationFrame(go));
                else go();
            };

            const d = driver({
                animate: !reduce,
                allowClose: true,
                disableActiveInteraction: true,
                showProgress: true,
                progressText: '{{current}} / {{total}}',
                overlayColor,
                popoverClass: 'walkthrough-popover',
                steps,
                nextBtnText: t('walkthrough.next'),
                prevBtnText: t('walkthrough.back'),
                doneBtnText: t('walkthrough.finish'),
                onNextClick: () => {
                    const cur = driverRef.current?.getActiveIndex() ?? 0;
                    if (cur >= STEP_DEFS.length - 1) { driverRef.current?.destroy(); return; }
                    advance(cur + 1, true);
                },
                onPrevClick: () => {
                    const cur = driverRef.current?.getActiveIndex() ?? 0;
                    if (cur <= 0) return;
                    advance(cur - 1, false);
                },
                onDestroyed: () => {
                    clearTyping();
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
            clearTyping();
            setDemoActive(false);
            setDemoQuery('');
            setDemoResults(null);
            driverRef.current = null;
        } finally {
            startingRef.current = false;
        }
    }, [t, keys.done, clearTyping, typeQuery]);

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

    useEffect(() => () => { clearTyping(); driverRef.current?.destroy(); }, [clearTyping]);

    return (
        <WalkthroughContext.Provider value={{ enabled: flagEnabled, start, demoActive, demoQuery, demoResults }}>
            {children}
        </WalkthroughContext.Provider>
    );
}
