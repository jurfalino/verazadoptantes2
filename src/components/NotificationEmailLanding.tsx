'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { parseEmailLanding } from '@/domain/notificationTracking';
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
 */
export default function NotificationEmailLanding() {
    const { data: session, status } = useSession();
    const handled = useRef(false);
    const [markReadId, setMarkReadId] = useState<string | null>(null);

    useEffect(() => {
        if (handled.current) return;
        handled.current = true;
        const landing = parseEmailLanding(window.location);
        if (!landing) return;
        trackNotificationEmailClicked(landing);
        // A fresh state object, as LoginHandoffReceiver does: reusing Next's
        // history state lets the router write the old URL back.
        window.history.replaceState({}, '', landing.cleanedUrl);
        if (landing.notificationId) setMarkReadId(landing.notificationId);
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
