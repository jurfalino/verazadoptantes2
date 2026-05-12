'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useRef } from 'react';
import { zarazSet, zarazTrack } from '@/lib/zaraz';

const SIGNED_IN_TRACKED_KEY = 'signed_in_tracked';

/**
 * Syncs the authenticated user's identity to Cloudflare Zaraz.
 *
 * When the user logs in, pushes userId, userRole, and userEmail
 * so that Amplitude (and any other Zaraz tools) can attribute
 * events to real users instead of anonymous device IDs.
 *
 * Also fires the `signed_in` event once per session transition (the
 * first step of the activation/onboarding funnels in Amplitude).
 * Deduplicated via sessionStorage keyed on userId so a page reload
 * while logged in doesn't refire — only true unauth → auth transitions
 * count. Cleared on sign-out so the next sign-in fires again.
 *
 * Renders nothing — pure side-effect component.
 */
export default function ZarazIdentify() {
    const { data: session } = useSession();
    const lastUserId = useRef<string | null>(null);

    useEffect(() => {
        const userId = (session?.user as { id?: string } | undefined)?.id;
        const isAdmin = (session?.user as { isAdmin?: boolean } | undefined)?.isAdmin;

        // Avoid re-pushing the same identity on every render
        if (userId === lastUserId.current) return;
        lastUserId.current = userId ?? null;

        if (userId) {
            zarazSet('userId', userId, 'session');
            zarazSet('userRole', isAdmin ? 'admin' : 'viewer', 'session');
            if (session?.user?.email) {
                zarazSet('userEmail', session.user.email, 'session');
            }
            // userName push (v2.14.9-17) was reverted in v2.14.9-18 — pushed
            // the Worker bundle just over Cloudflare's 3 MiB free-plan ceiling.
            // Re-add once bundle-size is brought under control.

            // Fire signed_in only on a real unauth → auth transition.
            // sessionStorage keyed on userId so a page refresh doesn't refire,
            // but a sign-out + sign-in (with same or different account) does.
            try {
                if (sessionStorage.getItem(SIGNED_IN_TRACKED_KEY) !== userId) {
                    zarazTrack('signed_in', { role: isAdmin ? 'admin' : 'viewer' });
                    sessionStorage.setItem(SIGNED_IN_TRACKED_KEY, userId);
                }
            } catch { /* sessionStorage may be unavailable (Safari private mode, etc.) — analytics is best-effort */ }
        } else {
            // Logged out — clear identity so events revert to anonymous
            zarazSet('userId', '', 'session');
            zarazSet('userRole', '', 'session');
            zarazSet('userEmail', '', 'session');
            try { sessionStorage.removeItem(SIGNED_IN_TRACKED_KEY); } catch { /* ignore */ }
        }
    }, [session]);

    return null;
}
