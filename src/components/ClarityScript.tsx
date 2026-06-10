'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useRef } from 'react';

/**
 * Microsoft Clarity identity sync (v2.19.29).
 *
 * Clarity itself is already loaded by Cloudflare Zaraz (the tag manager)
 * — we don't inject the loader from this app or sessions would
 * double-record. This component's only job is to call
 * `window.clarity('identify', userId, ..., email)` once the session
 * resolves so admin sessions map to a real person in the Clarity
 * dashboard instead of an anonymous device hash. Also pushes `role` +
 * `email` as Clarity custom dimensions for filtering.
 *
 * History: v2.19.28 also tried to inject the loader script directly
 * (mirroring `ZarazIdentify`) before we knew Clarity was already wired
 * through Zaraz. The loader-injection half was removed in v2.19.29 to
 * avoid the double-init that would have happened if anyone set the
 * `NEXT_PUBLIC_CLARITY_PROJECT_ID` build secret. Identity sync stayed.
 *
 * Robustness: the Clarity snippet pre-defines `window.clarity` as a
 * queueing function BEFORE the SDK script downloads, so any call we
 * make here gets queued and flushed when the SDK is ready. If Clarity
 * is missing entirely (ad-blocker, Zaraz tool disabled), the calls
 * silently drop — identity is best-effort metadata, not a gate.
 *
 * PII posture: the platform is internal-admin/rescuer-only — the public
 * surface lives on a separate domain — so we record everyone without
 * DOM-masking gymnastics (user-authorized 2026-06-10). The PII access
 * gating in the rest of the app is for cross-user exposure, not for
 * session replay vs the operator of the platform.
 */
declare global {
    interface Window {
        clarity?: {
            (cmd: 'identify', userId: string, sessionId?: string, pageId?: string, friendlyName?: string): void;
            (cmd: 'set', key: string, value: string | string[]): void;
            (cmd: 'event', eventName: string): void;
            (cmd: 'consent'): void;
            (cmd: 'upgrade', reason: string): void;
            q?: unknown[];
        };
    }
}

export default function ClarityScript() {
    const { data: session } = useSession();
    const lastIdentifiedUserId = useRef<string | null>(null);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const userId = (session?.user as { id?: string } | undefined)?.id;
        const isAdmin = (session?.user as { isAdmin?: boolean } | undefined)?.isAdmin;
        const email = session?.user?.email;
        const name = session?.user?.name;

        // Avoid re-identifying on every render — only on actual identity change.
        if (userId === lastIdentifiedUserId.current) return;
        if (!userId) {
            lastIdentifiedUserId.current = null;
            return;
        }

        // v2.19.31: poll until `window.clarity` exists. Clarity is loaded by
        // Zaraz, which runs asynchronously — when this useEffect first fires
        // (immediately after hydration), the Clarity loader hasn't necessarily
        // injected `window.clarity` yet. The previous version bailed silently
        // (`if (!c) return`), which meant identify never fired and admin
        // sessions stayed anonymous. Poll every 200ms for up to 10s; bail
        // permanently after. The official Clarity snippet self-defines a
        // queueing stub immediately, but Zaraz's wrapper may not, hence the
        // retry instead of relying on the queue.
        let attempts = 0;
        const MAX_ATTEMPTS = 50; // 50 × 200ms = 10s
        let timeoutId: ReturnType<typeof setTimeout> | null = null;

        const tryIdentify = () => {
            const c = window.clarity;
            if (!c) {
                if (++attempts < MAX_ATTEMPTS) {
                    timeoutId = setTimeout(tryIdentify, 200);
                }
                return;
            }
            lastIdentifiedUserId.current = userId;
            // friendlyName (5th arg) is what shows up next to the session in
            // the Clarity dashboard — use the Google display name, fall back
            // to the email local-part. Email and role go into custom session
            // dimensions for filtering / segmenting.
            const friendlyName = name?.trim() || email?.split('@')[0] || userId;
            c('identify', userId, undefined, undefined, friendlyName);
            c('set', 'role', isAdmin ? 'admin' : 'viewer');
            if (email) c('set', 'email', email);
            if (name) c('set', 'name', name);
        };
        tryIdentify();

        return () => {
            if (timeoutId !== null) clearTimeout(timeoutId);
        };
    }, [session]);

    return null;
}
