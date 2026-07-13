'use client';

import { useState } from 'react';
import Link from 'next/link';
import { signIn } from 'next-auth/react';

/**
 * Recovery UI for LEGITIMATE auth failures (as opposed to the adopter-login
 * gate's deliberate stonewall). Shown by /auth-error only for the pre-callback
 * OAuth error codes that a real user can hit — `Configuration` (Auth.js v5's
 * mapping for the `InvalidCheck` / pkce-code-verifier failure), `Verification`,
 * `OAuthCallbackError`, `OAuthSignin`, `OAuthCallback`. None of these can be
 * produced by the login gate, which runs AFTER OAuth succeeds — so routing them
 * here never exposes a blocked adopter (see auth-error/page.tsx).
 *
 * Unlike the deceptive page, this one is honest and gives a working way back in:
 * most of these failures are a stale / dropped OAuth cookie and clear on a fresh
 * sign-in. We deliberately do NOT auto-retry — some mobile cookie failures are
 * systematic and would just loop; one explicit click is the robust behaviour.
 */
export default function AuthErrorRecovery() {
    const [loading, setLoading] = useState(false);

    const retry = async () => {
        setLoading(true);
        try {
            await signIn('google', { redirectTo: '/' });
        } catch {
            // signIn navigates away on success; if it throws we just re-enable
            // the button so the user can try again.
            setLoading(false);
        }
    };

    return (
        <main className="min-h-screen bg-stone-50 flex items-center justify-center px-4 py-8">
            <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-stone-200 p-8 text-center">
                <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-teal-50 flex items-center justify-center text-teal-700">
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                        <path d="M21 12a9 9 0 1 1-3-6.7" strokeLinecap="round" />
                        <path d="M21 4v5h-5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </div>
                <h1 className="text-xl font-semibold text-stone-900 mb-2">
                    No pudimos iniciar tu sesión
                </h1>
                <p className="text-stone-600 text-sm leading-relaxed mb-6">
                    Puede que el enlace de acceso haya expirado. Volvé a intentarlo —
                    normalmente se resuelve al reintentar. Si sigue fallando, probá desde
                    tu navegador principal (no dentro de otra app) o borrá las cookies del sitio.
                </p>
                <button
                    onClick={retry}
                    disabled={loading}
                    className="inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl bg-teal-700 text-white text-sm font-medium hover:bg-teal-800 disabled:opacity-60 transition-colors"
                >
                    {loading ? 'Redirigiendo…' : 'Iniciar sesión con Google'}
                </button>
                <Link href="/" className="block mt-3 text-sm text-stone-500 hover:text-stone-700">
                    Volver al inicio
                </Link>
            </div>
        </main>
    );
}
