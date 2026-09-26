'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import posthog from 'posthog-js';
import { flushPostHogQueue, posthogTrack } from '@/lib/zaraz';

// One `signed_in_visit` per browser session per user: the funnel's "signed in"
// step. `signed_in` alone only fires on a fresh login, so a rescuer whose
// session is still valid from last week would never count as signed in.
const SIGNED_IN_VISIT_KEY = 'posthog_signed_in_visit';

/**
 * PostHog session replay + product analytics (v2.49.0).
 *
 * Runs in PARALLEL with Clarity and Amplitude — replaces neither yet.
 *
 * Why this is app code and not a Zaraz tool, unlike every other tag on this
 * site: Zaraz's PostHog component forwards events server-side and cannot do
 * session replay, which needs client-side rrweb. This is a forced exception to
 * the house pattern, not a preference.
 *
 * Why props instead of `NEXT_PUBLIC_*`: those are inlined at build time and
 * Cloudflare runtime env vars never reach them (see `src/lib/contractUrl.ts`).
 * `layout.tsx` resolves the flag and key server-side and passes them down, so
 * the value can differ per environment without a rebuild — and the flag costs
 * no client fetch, which matters because a client `/api/config` fetch once cost
 * ~2s of LCP on the homepage (see `HomeClient.tsx`).
 *
 * PRIVACY: recording is deliberately UNMASKED — search terms, adopter forms and
 * profile pages all record in cleartext. User decision, 2026-09-01; rationale in
 * .agents/plans/2026-09-01-posthog-integration.md (D1).
 *
 * Verified against posthog-js 1.424.1 source: on web, `maskAllInputs` defaults
 * to `true` and `maskTextSelector` defaults to `undefined` (text is NOT masked).
 * So the `maskAllInputs: false` below is load-bearing — without it the search
 * box stays masked and this whole change accomplishes nothing. Page text needs
 * no option because it is already unmasked. `input[type="password"]` remains
 * masked by rrweb unconditionally; the app is Google-OAuth-only regardless.
 */
export default function PostHogProvider({
    enabled,
    projectKey,
}: {
    enabled: boolean;
    projectKey: string | null;
}) {
    const { data: session } = useSession();
    const initialized = useRef(false);
    // State, not just the ref: the session usually resolves BEFORE the deferred
    // init runs, and a ref change doesn't re-run the identify effect — so those
    // users were never identified until the session object happened to change.
    const [ready, setReady] = useState(false);
    const lastIdentifiedUserId = useRef<string | null>(null);

    useEffect(() => {
        if (!enabled || !projectKey || initialized.current) return;
        if (typeof window === 'undefined') return;

        // Defer past first paint. posthog-js with replay is far heavier than the
        // Clarity snippet, and `/` is `runtime = 'edge'` specifically for cold
        // starts — telemetry must not buy itself LCP.
        const start = () => {
            if (initialized.current) return;
            initialized.current = true;
            posthog.init(projectKey, {
                api_host: '/ingest',
                ui_host: 'https://us.posthog.com',
                autocapture: true,
                capture_pageview: true,
                session_recording: {
                    maskAllInputs: false,
                },
            });
            flushPostHogQueue();
            setReady(true);
        };

        const w = window as Window & {
            requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
        };
        if (typeof w.requestIdleCallback === 'function') {
            w.requestIdleCallback(start, { timeout: 3000 });
        } else {
            // Safari has no requestIdleCallback.
            setTimeout(start, 1500);
        }
    }, [enabled, projectKey]);

    useEffect(() => {
        if (!enabled || !ready) return;

        const userId = (session?.user as { id?: string } | undefined)?.id;
        const isAdmin = (session?.user as { isAdmin?: boolean } | undefined)?.isAdmin;
        const email = session?.user?.email;
        const name = session?.user?.name;

        // Only on actual identity change, not every render — same guard as
        // ClarityScript.
        if (userId === lastIdentifiedUserId.current) return;
        if (!userId) {
            lastIdentifiedUserId.current = null;
            return;
        }
        lastIdentifiedUserId.current = userId;

        posthog.identify(userId, {
            email: email ?? undefined,
            name: name ?? undefined,
            role: isAdmin ? 'admin' : 'viewer',
        });

        try {
            if (sessionStorage.getItem(SIGNED_IN_VISIT_KEY) !== userId) {
                posthogTrack('signed_in_visit', { role: isAdmin ? 'admin' : 'viewer' });
                sessionStorage.setItem(SIGNED_IN_VISIT_KEY, userId);
            }
        } catch { /* sessionStorage may be unavailable (Safari private mode) — analytics is best-effort */ }
    }, [session, enabled, ready]);

    return null;
}
