'use client';

/**
 * Guided walkthrough (v2.22.0) — opens a self-contained, click-Next demo modal
 * (WalkthroughDemoModal) that teaches "search before you hand over an animal"
 * over three mocked records. This provider owns the flag, the new-user
 * auto-launch (once), per-email persistence, and the modal open/close state.
 */

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { WalkthroughDemoModal } from './WalkthroughDemoModal';

interface WalkthroughContextValue {
    enabled: boolean;
    start: () => void;
}

const WalkthroughContext = createContext<WalkthroughContextValue>({ enabled: false, start: () => {} });

export const useWalkthrough = () => useContext(WalkthroughContext);

const keysFor = (email: string | null) => {
    const e = email || 'anon';
    return { pending: `walkthrough_pending_${e}`, done: `walkthrough_done_${e}` };
};

export function WalkthroughProvider({
    flagEnabled,
    userEmail,
    children,
}: {
    flagEnabled: boolean;
    userEmail: string | null;
    children: React.ReactNode;
}) {
    const [open, setOpen] = useState(false);
    const keys = keysFor(userEmail);

    const start = useCallback(() => setOpen(true), []);

    const close = useCallback(() => {
        setOpen(false);
        try { localStorage.setItem(keys.done, '1'); } catch { /* SSR-safe */ }
    }, [keys.done]);

    // Auto-launch once for genuine new users (pending set by CountryConfirmBanner's
    // new-user path, so flipping the flag on never floods existing users).
    useEffect(() => {
        if (!flagEnabled || !userEmail) return;
        try {
            if (localStorage.getItem('playwright_test_mode') === '1') return; // E2E escape
            if (localStorage.getItem(keys.pending) !== '1') return;
            if (localStorage.getItem(keys.done) === '1') return;
        } catch { return; }
        // Let the page (and the country-confirm banner) settle first.
        const timer = setTimeout(() => {
            try { localStorage.removeItem(keys.pending); } catch { /* ignore */ }
            setOpen(true);
        }, 900);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [flagEnabled, userEmail]);

    return (
        <WalkthroughContext.Provider value={{ enabled: flagEnabled, start }}>
            {children}
            <WalkthroughDemoModal open={open} onClose={close} isAuthenticated={!!userEmail} />
        </WalkthroughContext.Provider>
    );
}
