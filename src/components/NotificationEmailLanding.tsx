'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { parseEmailLanding, type EmailLanding } from '@/domain/notificationTracking';
import { trackNotificationEmailClicked } from '@/lib/notificationEvents';
import { reportClientError } from '@/lib/clientErrorReporter';
import { isViewingAs } from '@/lib/viewAsClient';

/**
 * Mounted once in the root layout. A link from one of our emails carries
 * `ch=email` (+ `n`, `kind`; src/domain/notificationTracking.ts): send
 * `notification_email_clicked`, then take those params out of the address bar
 * with replaceState — no navigation, no reload. An email click is always a
 * full page load, so reading `window.location` on mount is enough (and avoids
 * `useSearchParams`, which needs a Suspense boundary in the layout).
 *
 * When the link names a notification, it is marked read through the bell's
 * own path (PATCH /api/notifications, scoped server-side to the signed-in
 * user's rows): the person has seen it in the email and acted on it.
 *
 * Signed out on a protected page, middleware sends the person to
 * `/?callbackUrl=<tagged path>` and HomeClient opens the login with that path
 * and clears `callbackUrl` in its own mount effect — so the URL is read during
 * this component's first client render (before any effect runs), the click is
 * counted there with via_login, and the URL is left to HomeClient. After sign-in
 * the person lands on the tagged path again: sessionStorage keeps that from
 * counting twice, and the notice is marked read then.
 *
 * replaceState runs on the next tick, after Next's router has patched history
 * (otherwise Next's own URL state keeps the tags and a router.refresh() writes
 * them back), and is guarded: a crafted `//host/…` path would throw.
 */

const SEEN_KEY = 'ba:notifEmailSeen';
const SEEN_TTL_MS = 30 * 60 * 1000;

/** True the first time this tab sees this email click in the last 30 min (storage blocked → true). */
function firstSighting(key: string): boolean {
    try {
        const seen = JSON.parse(sessionStorage.getItem(SEEN_KEY) || '{}') as Record<string, number>;
        const now = Date.now();
        const fresh = Object.fromEntries(Object.entries(seen).filter(([, at]) => now - at < SEEN_TTL_MS));
        if (fresh[key]) return false;
        fresh[key] = now;
        sessionStorage.setItem(SEEN_KEY, JSON.stringify(fresh));
        return true;
    } catch {
        // SSR-safe storage access (private mode / blocked): count it.
        return true;
    }
}
export default function NotificationEmailLanding() {
    const { data: session, status } = useSession();
    // Read during the first client render: HomeClient's mount effect may clear callbackUrl before ours runs.
    const landingRef = useRef<EmailLanding | null | undefined>(undefined);
    if (landingRef.current === undefined && typeof window !== 'undefined') {
        landingRef.current = parseEmailLanding(window.location);
    }
    const handled = useRef(false);
    const [markReadId, setMarkReadId] = useState<string | null>(null);

    useEffect(() => {
        if (handled.current) return;
        handled.current = true;
        const landing = landingRef.current;
        if (!landing) return;
        if (firstSighting(`${landing.kind}:${landing.notificationId ?? ''}`)) trackNotificationEmailClicked(landing);
        if (landing.notificationId && !landing.viaLogin) setMarkReadId(landing.notificationId);
        if (landing.viaLogin) return; // HomeClient owns this URL (login + clearing callbackUrl)
        const cleaned = landing.cleanedUrl;
        // No cleanup: in dev StrictMode a cleanup would cancel it and `handled` blocks the re-run.
        window.setTimeout(() => {
            try {
                const target = new URL(cleaned, window.location.origin);
                if (target.origin !== window.location.origin) return;
                // A fresh state object, as LoginHandoffReceiver does.
                window.history.replaceState({}, '', target.pathname + target.search + target.hash);
            } catch (e) {
                void reportClientError({
                    message: e instanceof Error ? e.message : String(e),
                    source: 'NotificationEmailLanding.replaceState', level: 'warn', extra: { kind: landing.kind },
                });
            }
        }, 0);
    }, []);

    useEffect(() => {
        if (!markReadId || status === 'loading') return;
        const id = markReadId;
        setMarkReadId(null);
        // Signed out: nothing to mark. Viewing as someone: the row isn't theirs.
        if (status !== 'authenticated' || isViewingAs(session)) return;
        const warn = (message: string) => void reportClientError({
            message, source: 'NotificationEmailLanding.markRead', level: 'warn', extra: { notificationId: id },
        });
        fetch('/api/notifications', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id }),
        })
            .then(res => { if (!res.ok && res.status !== 401) warn(`mark read failed: HTTP ${res.status}`); })
            .catch((e: unknown) => warn(e instanceof Error ? e.message : String(e)));
    }, [markReadId, status, session]);

    return null;
}
