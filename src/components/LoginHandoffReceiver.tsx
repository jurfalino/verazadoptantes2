'use client';

/**
 * Finishes a sign-in that started somewhere else. Mounted once in the root
 * layout; renders nothing.
 *
 * - `?login=google.<ms>` — Chrome was opened from an Instagram/Facebook
 *   in-app browser (src/lib/googleSignIn.ts). The visitor already tapped
 *   "Continuar con Google" there, so start the sign-in right away.
 * - `?login=email.<ms>` — the in-app browser followed the intent's fallback
 *   (Chrome missing): open the login box with the email code first.
 * - No marker, but an email code was sent from this same page before it
 *   reloaded (pendingOtp): reopen the login box on the code step. Closing
 *   the box clears that, so it doesn't follow the visitor around.
 *
 * The marker is stripped from the address bar before anything else, never
 * reaches redirectTo, and expires after two minutes, so a copied link can't
 * send a stranger to Google. Google is never auto-started from inside an
 * in-app browser — that is the browser Google refuses, and a reload of the
 * marked URL there would loop.
 */

import { useEffect, useRef } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { useAuthContext } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { LOGIN_HANDOFF_PARAM, parseHandoffMarker, withoutHandoffMarker, type LoginHandoff } from '@/domain/inAppBrowser';
import { currentBrowserEnv } from '@/lib/googleSignIn';
import { readPendingOtp } from '@/lib/pendingOtp';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { posthogTrack } from '@/lib/zaraz';

type Pending = { kind: LoginHandoff | 'email-code'; returnPath: string };

export default function LoginHandoffReceiver() {
    const { status } = useSession();
    const { openLogin } = useAuthContext();
    const { t } = useLanguage();
    const toast = useShowToast();
    const pending = useRef<Pending | null>(null);

    // Runs once, before the session resolves: take the marker out of the URL.
    useEffect(() => {
        const raw = new URLSearchParams(window.location.search).get(LOGIN_HANDOFF_PARAM);
        const returnPath = withoutHandoffMarker(`${window.location.pathname}${window.location.search}`);
        if (raw !== null) {
            window.history.replaceState(window.history.state, '', `${returnPath}${window.location.hash}`);
            const kind = parseHandoffMarker(raw, Date.now());
            if (kind) pending.current = { kind, returnPath };
            return;
        }
        const otp = readPendingOtp();
        if (otp && otp.returnPath === returnPath) pending.current = { kind: 'email-code', returnPath: otp.returnPath };
    }, []);

    useEffect(() => {
        if (status === 'loading' || !pending.current) return;
        const { kind, returnPath } = pending.current;
        pending.current = null;
        if (status === 'authenticated') return;

        const env = currentBrowserEnv();
        if (kind === 'email-code') {
            openLogin(returnPath, 'email-code');
            return;
        }
        posthogTrack('login_inapp_handoff_arrived', { kind, inApp: env.inApp ?? 'none', os: env.os });
        if (kind === 'google' && !env.inApp) {
            signIn('google', { redirectTo: returnPath }).catch((e) => {
                // Leave them a working box rather than a page that did nothing.
                toast.error(t('errors.generic'), t('login.google_failed'), resolveErrorId(e, 'LoginHandoffReceiver.google'));
                openLogin(returnPath);
            });
            return;
        }
        openLogin(returnPath, 'email-first');
    }, [status, openLogin, toast, t]);

    return null;
}
