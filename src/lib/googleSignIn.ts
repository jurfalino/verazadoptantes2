/**
 * The one way every "Continuar con Google" button starts sign-in.
 *
 * In a real browser it is just `signIn('google')`. In an Android in-app
 * browser (Instagram, Facebook…) — where Google blocks OAuth — it first
 * reopens the page in Chrome via an intent URL; Chrome then starts the
 * sign-in itself (LoginHandoffReceiver). See src/domain/inAppBrowser.ts for
 * why the jump has to come before signIn().
 */

import { signIn } from 'next-auth/react';
import { buildChromeIntentUrl, detectBrowserEnv, withoutHandoffMarker, type BrowserEnv } from '@/domain/inAppBrowser';
import { posthogTrack } from '@/lib/zaraz';

/** How long to wait for the page to go to the background after the intent. */
const HANDOFF_WAIT_MS = 2500;

export type GoogleSignInOutcome =
    /** signIn() is navigating to Google. */
    | 'redirecting'
    /** Chrome took over; this in-app page is now in the background. */
    | 'handed-off'
    /** The in-app browser ignored the intent — offer the email code instead. */
    | 'handoff-failed';

export function currentBrowserEnv(): BrowserEnv {
    return detectBrowserEnv(typeof navigator === 'undefined' ? '' : navigator.userAgent);
}

/** pathname + query of the current page (never the hash), minus any hand-off marker. */
export function currentReturnPath(): string {
    return withoutHandoffMarker(`${window.location.pathname}${window.location.search}`);
}

/**
 * Resolves true if the page was hidden within `ms` — i.e. another app
 * (Chrome) came to the front. An in-app browser that swallows the intent
 * leaves the page visible. `blur` is deliberately not counted: a "leave
 * Instagram?" confirmation dialog blurs the page without leaving it.
 */
function waitForPageToHide(ms: number): Promise<boolean> {
    return new Promise((resolve) => {
        let done = false;
        const finish = (left: boolean) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('pagehide', onHide);
            resolve(left);
        };
        const onVisibility = () => { if (document.visibilityState === 'hidden') finish(true); };
        const onHide = () => finish(true);
        const timer = setTimeout(() => finish(document.visibilityState === 'hidden'), ms);
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('pagehide', onHide);
    });
}

/**
 * Start Google sign-in, returning to `returnPath` afterwards.
 * Throws whatever signIn() throws — callers report it with resolveErrorId.
 */
export async function startGoogleSignIn(returnPath: string, source: string): Promise<GoogleSignInOutcome> {
    const env = currentBrowserEnv();
    const redirectTo = withoutHandoffMarker(returnPath);

    if (env.inApp && env.os === 'android') {
        // Chrome reopens THIS page (public); the destination rides along.
        const intentUrl = buildChromeIntentUrl(window.location.origin, currentReturnPath(), Date.now(), redirectTo);
        const hidden = waitForPageToHide(HANDOFF_WAIT_MS);
        // Sent before leaving: the outcome event may never flush if Chrome
        // takes over, and attempts must line up with Chrome's arrivals.
        posthogTrack('login_inapp_handoff', { app: env.inApp, outcome: 'attempt', source });
        window.location.href = intentUrl;
        const left = await hidden;
        posthogTrack('login_inapp_handoff', { app: env.inApp, outcome: left ? 'left' : 'stayed', source });
        return left ? 'handed-off' : 'handoff-failed';
    }

    if (env.inApp) posthogTrack('login_inapp_google', { app: env.inApp, os: env.os, source });
    await signIn('google', { redirectTo });
    return 'redirecting';
}
