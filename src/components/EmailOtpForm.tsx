'use client';

/**
 * Email OTP sign-in — the two-step "email → 6-digit code" form shared by
 * LoginModal and the full-page Login. Rendered only when the caller has
 * confirmed ENABLE_EMAIL_OTP via /api/config.
 *
 * Verification goes through signIn('email-otp', { redirect: false }) so the
 * NextAuth Credentials provider (and with it the adopter-login gate) decides;
 * this component never handles codes beyond passing them through.
 */

import { signIn } from 'next-auth/react';
import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { requestEmailOtp } from '@/app/actions/emailOtp';

const RESEND_COOLDOWN_SEC = 60; // matches the server's per-email min gap

export default function EmailOtpForm({ redirectPath }: { redirectPath?: string | null }) {
    const { t, locale } = useLanguage();
    const [step, setStep] = useState<'email' | 'code'>('email');
    const [email, setEmail] = useState('');
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [cooldown, setCooldown] = useState(0);
    const codeInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (cooldown <= 0) return;
        const id = setInterval(() => setCooldown(c => (c > 1 ? c - 1 : 0)), 1000);
        return () => clearInterval(id);
    }, [cooldown > 0]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (step === 'code') codeInputRef.current?.focus();
    }, [step]);

    const sendCode = async () => {
        if (busy || !email.trim()) return;
        setBusy(true);
        setError(null);
        try {
            const res = await requestEmailOtp(email, locale);
            if (!res) {
                setError(t('errors.generic'));
            } else if (res.success) {
                setStep('code');
                setCode('');
                setCooldown(RESEND_COOLDOWN_SEC);
            } else if (res.error === 'invalid_email') {
                setError(t('login.invalid_email'));
            } else if (res.error === 'rate_limited') {
                setError(res.retryAfterSec
                    ? `${t('login.retry_in')} ${res.retryAfterSec}s`
                    : t('login.rate_limited'));
            } else {
                // disabled | send_failed — generic message, surface the errorId
                // so the user can report something traceable.
                setError(res.errorId ? `${t('errors.generic')} (${res.errorId})` : t('errors.generic'));
            }
        } catch {
            setError(t('errors.generic'));
        } finally {
            setBusy(false);
        }
    };

    const verifyCode = async () => {
        if (busy || code.length !== 6) return;
        setBusy(true);
        setError(null);
        try {
            const res = await signIn('email-otp', { email, code, redirect: false });
            if (res?.error) {
                setError(t('login.code_invalid'));
                setBusy(false);
                return;
            }
            // Full reload so the fresh session cookie drives the whole tree,
            // same net effect as the Google OAuth redirect.
            window.location.assign(redirectPath || window.location.pathname);
        } catch {
            setError(t('errors.generic'));
            setBusy(false);
        }
    };

    if (step === 'email') {
        return (
            <div className="space-y-2">
                <div className="flex gap-2">
                    <input
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && sendCode()}
                        placeholder={t('login.email_placeholder')}
                        autoComplete="email"
                        data-testid="otp-email-input"
                        className="flex-1 min-w-0 px-3 py-2 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                    <button
                        onClick={sendCode}
                        disabled={busy || !email.trim()}
                        data-testid="otp-send-btn"
                        className="px-4 py-2 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                    >
                        {busy ? t('login.sending') : t('login.email_btn')}
                    </button>
                </div>
                <p className="text-xs text-stone-500">{t('login.email_code_hint')}</p>
                {error && <p className="text-xs text-rose-600" role="alert">{error}</p>}
            </div>
        );
    }

    return (
        <div className="space-y-2">
            <p className="text-sm text-stone-600">
                {t('login.code_sent')} <span className="font-semibold text-stone-800 break-all">{email}</span>
            </p>
            <div className="flex gap-2">
                <input
                    ref={codeInputRef}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                    onKeyDown={e => e.key === 'Enter' && verifyCode()}
                    placeholder="123456"
                    aria-label={t('login.code_label')}
                    data-testid="otp-code-input"
                    className="flex-1 min-w-0 px-3 py-2 text-lg tracking-[0.3em] font-mono text-center border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
                <button
                    onClick={verifyCode}
                    disabled={busy || code.length !== 6}
                    data-testid="otp-verify-btn"
                    className="px-4 py-2 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                    {t('login.verify_btn')}
                </button>
            </div>
            {error && <p className="text-xs text-rose-600" role="alert">{error}</p>}
            <div className="flex items-center justify-between text-xs">
                <button
                    onClick={() => { setStep('email'); setError(null); }}
                    className="text-stone-500 hover:text-teal-700 transition-colors"
                >
                    {t('login.change_email')}
                </button>
                {cooldown > 0 ? (
                    <span className="text-stone-400">{t('login.resend_in')} {cooldown}s</span>
                ) : (
                    <button
                        onClick={sendCode}
                        disabled={busy}
                        data-testid="otp-resend-btn"
                        className="text-teal-700 hover:text-teal-800 font-medium transition-colors disabled:opacity-50"
                    >
                        {t('login.resend')}
                    </button>
                )}
            </div>
        </div>
    );
}
