'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useRef } from 'react';
import Script from 'next/script';

/**
 * Microsoft Clarity session-replay + heatmap integration (v2.19.28).
 *
 * Mounted from the root layout. The component itself is always rendered;
 * the actual `<Script>` only injects when `NEXT_PUBLIC_CLARITY_PROJECT_ID`
 * is set, so the loader is a no-op in dev / preview / any env without the
 * var. Bundled directly rather than via Zaraz so a redeploy isn't needed
 * to toggle (env var change in Cloudflare Pages → next build → live).
 *
 * Identity sync: once the script has loaded AND the user is signed in,
 * call `window.clarity('identify', userId, sessionId?, pageId?, friendlyName?)`
 * so admin sessions map to a real user in the Clarity dashboard. Email is
 * the friendlyName so a session pulled up by hash maps back to a person
 * without cross-referencing user IDs.
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

const PROJECT_ID = process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID;

export default function ClarityScript() {
    const { data: session } = useSession();
    const lastIdentifiedUserId = useRef<string | null>(null);

    useEffect(() => {
        if (!PROJECT_ID) return;
        if (typeof window === 'undefined') return;

        const userId = (session?.user as { id?: string } | undefined)?.id;
        const isAdmin = (session?.user as { isAdmin?: boolean } | undefined)?.isAdmin;
        const email = session?.user?.email;

        // Avoid re-identifying on every render — only on actual identity change.
        if (userId === lastIdentifiedUserId.current) return;
        lastIdentifiedUserId.current = userId ?? null;

        if (!userId) return;

        // Clarity may not have loaded yet — its global script self-defers calls
        // via the queue (`clarity.q`), so this works even pre-load. If the
        // script never loads (ad-blocker, network failure), the calls quietly
        // drop. Acceptable: identify is best-effort metadata, not a gate.
        const c = window.clarity;
        if (!c) return;
        c('identify', userId, undefined, undefined, email ?? undefined);
        c('set', 'role', isAdmin ? 'admin' : 'viewer');
        if (email) c('set', 'email', email);
    }, [session]);

    if (!PROJECT_ID) return null;

    return (
        <Script
            id="ms-clarity"
            strategy="afterInteractive"
            dangerouslySetInnerHTML={{
                __html: `
                    (function(c,l,a,r,i,t,y){
                        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
                        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
                        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
                    })(window, document, "clarity", "script", "${PROJECT_ID}");
                `,
            }}
        />
    );
}
