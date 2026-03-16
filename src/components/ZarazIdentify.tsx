'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useRef } from 'react';
import { zarazSet } from '@/lib/zaraz';

/**
 * Syncs the authenticated user's identity to Cloudflare Zaraz.
 *
 * When the user logs in, pushes userId, userRole, and userEmail
 * so that Amplitude (and any other Zaraz tools) can attribute
 * events to real users instead of anonymous device IDs.
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
        } else {
            // Logged out — clear identity so events revert to anonymous
            zarazSet('userId', '', 'session');
            zarazSet('userRole', '', 'session');
            zarazSet('userEmail', '', 'session');
        }
    }, [session]);

    return null;
}
