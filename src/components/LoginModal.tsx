'use client';

import { signIn } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useAuthContext, type LoginReason } from '@/context/AuthContext';
import EmailOtpForm from '@/components/EmailOtpForm';
import { currentBrowserEnv, currentReturnPath, startGoogleSignIn } from '@/lib/googleSignIn';
import { inAppDisplayName } from '@/domain/inAppBrowser';
import { reportClientError, resolveErrorId } from '@/lib/clientErrorReporter';
import { posthogTrack } from '@/lib/zaraz';
import { clearPendingOtp } from '@/lib/pendingOtp';

export default function LoginModal() {
    const { isLoginOpen, closeLogin, redirectPath, loginReason } = useAuthContext();
    if (!isLoginOpen) return null;
    return (
        <div className="fixed inset-0 bg-teal-950/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
            {/* Closing abandons a pending email code, so it won't reopen on reload. */}
            <LoginPanel redirectPath={redirectPath} onClose={() => { clearPendingOtp(); closeLogin(); }} reason={loginReason} />
        </div>
    );
}

/**
 * The sign-in box itself, without the full-screen backdrop, so a surface can
 * show the same box in place (the ?variant=signin prototype puts it over the
 * top of a logged-out visitor's results). Mounting it is opening it.
 */
export function LoginPanel({ redirectPath, onClose, reason = null, className = '' }: {
    redirectPath: string | null;
    onClose: () => void;
    reason?: LoginReason | null;
    className?: string;
}) {
    const { t } = useLanguage();
    const [loading, setLoading] = useState(false);
    const [devEmail, setDevEmail] = useState('');
    const [emailOtpEnabled, setEmailOtpEnabled] = useState(false);
    const [googleError, setGoogleError] = useState<string | null>(null);
    // Read once: the panel only mounts in the browser (opening it is a click
    // or the hand-off receiver), so navigator is there.
    const [env] = useState(currentBrowserEnv);
    // Set when an Android in-app browser ignored the jump to Chrome.
    const [handoffFailed, setHandoffFailed] = useState(false);
    // Google can't sign in here, so the email code leads instead of hiding
    // behind the reveal link: iOS in-app browsers (no way out to Safari), a
    // failed hand-off, or the receiver sending the visitor back to us.
    const emailFirst = reason === 'email-first' || handoffFailed || (env.inApp !== null && env.os !== 'android');
    // Google stays the single visible choice; the email fields appear only
    // after the user asks for them (progressive disclosure —
    // docs/ux-ui-guidelines.md §4.4, and the pattern users already know from
    // Slack/Notion, §4.6 Jakob's Law). A code already sent reopens them.
    const [emailOtpOpen, setEmailOtpOpen] = useState(reason === 'email-code');
    const appName = inAppDisplayName(env.inApp) ?? t('login.inapp_this_app');

    // Public flag read — the email option only renders when an admin has
    // switched ENABLE_EMAIL_OTP on (Resend must be configured first).
    // Mounted per opening (LoginModal renders it only while open), so the email
    // panel starts collapsed each time and the flag is read on each opening.
    useEffect(() => {
        fetch('/api/config')
            .then(res => res.json())
            .then((data) => {
                const cfg = data as { config?: Record<string, string> };
                setEmailOtpEnabled(cfg.config?.ENABLE_EMAIL_OTP === 'true');
            })
            .catch((e) => {
                // Without the flag the email option stays hidden — in an
                // in-app browser that leaves only Google, which can't work.
                reportClientError({
                    level: 'warn',
                    message: `login config fetch failed: ${e instanceof Error ? e.message : String(e)}`,
                    source: 'LoginPanel.config',
                    extra: { inApp: env.inApp },
                });
            });
    }, [env.inApp]);

    useEffect(() => {
        if (emailFirst) posthogTrack('login_email_first_shown', { app: env.inApp ?? 'none', os: env.os, why: handoffFailed ? 'handoff_failed' : reason ?? 'ios_inapp' });
    }, [emailFirst]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleGoogleLogin = async () => {
        setLoading(true);
        setGoogleError(null);
        try {
            const outcome = await startGoogleSignIn(redirectPath || currentReturnPath(), 'LoginPanel');
            // 'redirecting' leaves the button busy until Google's page loads.
            if (outcome === 'handoff-failed') setHandoffFailed(true);
            if (outcome !== 'redirecting') setLoading(false);
        } catch (e) {
            setGoogleError(`${t('login.google_failed')} (${resolveErrorId(e, 'LoginPanel.google')})`);
            setLoading(false);
        }
    };

    const handleDevLogin = async () => {
        if (!devEmail) return;
        setLoading(true);
        await signIn('dev-login', { email: devEmail, redirectTo: redirectPath || currentReturnPath() });
    };

    const emailForm = <EmailOtpForm redirectPath={redirectPath || undefined} autoFocusEmail={!emailFirst} />;

    return (
        <div className={`bg-white rounded-2xl shadow-2xl max-w-sm w-full p-8 relative border border-teal-100 ${className}`}>
            <button
                onClick={onClose}
                className="absolute top-4 right-4 text-stone-500 hover:text-teal-700 transition-colors"
            >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>

            <div className="text-center mb-8">
                <h2 className="text-2xl font-semibold text-teal-900 tracking-tight">{t('auth.login_title') || 'Sign In'}</h2>
                <p className="text-teal-700 text-sm mt-2">{t('auth.login_desc') || 'Sign in to access this information.'}</p>
            </div>

            <div className="space-y-4">
                {/* In-app browser where Google can't sign in: the email code leads */}
                {emailFirst && emailOtpEnabled && (
                    <div data-testid="login-email-first" className="space-y-3">
                        <p className="text-sm text-teal-800 bg-teal-50 border border-teal-100 rounded-xl px-3 py-2">
                            {handoffFailed
                                ? t('login.inapp_handoff_failed')
                                : t('login.inapp_email_first').replace('{app}', appName)}
                        </p>
                        {emailForm}
                        <div className="flex-1 h-px bg-stone-200" />
                    </div>
                )}
                {emailFirst && !emailOtpEnabled && (
                    <p data-testid="login-open-in-browser" className="text-sm text-teal-800 bg-teal-50 border border-teal-100 rounded-xl px-3 py-2">
                        {t('login.inapp_open_in_browser').replace('{app}', appName)}
                    </p>
                )}

                {/* Google Login */}
                <button
                    onClick={handleGoogleLogin}
                    disabled={loading}
                    className="flex items-center justify-center gap-3 px-6 py-3 bg-white border border-stone-200 rounded-xl shadow-sm hover:shadow-md hover:bg-stone-50 transition-all w-full group disabled:opacity-70"
                >
                    <svg className="w-5 h-5" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg>
                    <span className="font-semibold text-stone-700 group-hover:text-stone-900">
                        {loading ? t('auth.signing_in') || 'Signing in...' : t('auth.continue_google')}
                    </span>
                </button>
                {/* Android in-app: the button reopens the page in Chrome first */}
                {env.inApp && env.os === 'android' && !handoffFailed && (
                    <p data-testid="login-opens-in-chrome" className="-mt-2 text-xs text-center text-stone-500">{t('login.inapp_opens_chrome')}</p>
                )}
                {googleError && <p className="text-xs text-rose-600 text-center" role="alert">{googleError}</p>}

                {/* Email OTP login — feature-flagged, collapsed until asked for */}
                {emailOtpEnabled && !emailFirst && (
                    <>
                        <div className="flex items-center gap-3 my-2">
                            <div className="flex-1 h-px bg-stone-200" />
                            <button
                                type="button"
                                onClick={() => setEmailOtpOpen(v => !v)}
                                aria-expanded={emailOtpOpen}
                                aria-controls="email-otp-panel"
                                data-testid="otp-reveal-btn"
                                className="flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-900 transition-colors rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
                            >
                                {t('login.email_label')}
                                <svg
                                    className={`w-3.5 h-3.5 transition-transform duration-200 ${emailOtpOpen ? 'rotate-180' : ''}`}
                                    fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"
                                >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>
                            <div className="flex-1 h-px bg-stone-200" />
                        </div>
                        {emailOtpOpen && (
                            <div id="email-otp-panel">
                                {emailForm}
                            </div>
                        )}
                    </>
                )}

                {/* Dev Login — only in development */}
                {typeof window !== 'undefined' && window.location.hostname === 'localhost' && (
                    <>
                        <div className="flex items-center gap-3 my-2">
                            <div className="flex-1 h-px bg-stone-200" />
                            <span className="text-xs text-stone-500 uppercase">Dev</span>
                            <div className="flex-1 h-px bg-stone-200" />
                        </div>
                        <div className="flex gap-2">
                            <input
                                type="email"
                                value={devEmail}
                                onChange={e => setDevEmail(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleDevLogin()}
                                placeholder="test@example.com"
                                className="flex-1 px-3 py-2 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                            />
                            <button
                                onClick={handleDevLogin}
                                disabled={loading || !devEmail}
                                className="px-4 py-2 text-sm font-medium text-white bg-stone-700 hover:bg-stone-800 rounded-lg disabled:opacity-50"
                            >
                                Dev Sign In
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
