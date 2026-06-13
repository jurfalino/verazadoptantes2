export const runtime = 'edge';
import AuthErrorReportForm from '@/components/AuthErrorReportForm';
import { logger } from '@/lib/logger';
import { headers } from 'next/headers';

/**
 * Generic auth-error page. NextAuth redirects here whenever the signIn
 * callback returns false or an unhandled auth error occurs. The adopter-
 * login gate (v2.14.9-14) explicitly routes blocked attempts to this page.
 *
 * Copy is intentionally vague — "ocurrió un error inesperado" — and gives no
 * hint that the user was blocked. From the rejected user's perspective the
 * app looks broken; that's the desired outcome since the registry is
 * supposed to be invisible to flagged adopters.
 *
 * The "report this problem" form is real: submissions land in the
 * `error_reports` table and surface on /admin/blocked-logins so the
 * operator can see what blocked users said. Adding the form also makes the
 * deception more credible — real apps have error-report flows.
 *
 * v2.19.36: server-side diagnostic logging of NextAuth's `?error=` query
 * param. Doesn't change anything the user sees; surfaces the actual error
 * code (OAuthCallbackError / Configuration / Verification / AccessDenied /
 * etc.) in Axiom so we can debug intermittent account-switch failures
 * without exposing the reason to the user. `AccessDenied` is the
 * blocked-adopter path and is already audited via `recordBlockedLogin` —
 * still logged here too so a single Axiom query catches every landing on
 * this page. Includes the cf-ray header so a single failed attempt can be
 * cross-referenced with the NextAuth core handler logs that produced it.
 */
export default async function AuthErrorPage({
    searchParams,
}: {
    searchParams: Promise<{ error?: string; code?: string }>;
}) {
    const { error, code } = await searchParams;
    try {
        const h = await headers();
        logger.warn('auth-error page hit', {
            // The NextAuth v5 error code: 'OAuthCallbackError', 'Configuration',
            // 'Verification', 'AccessDenied', 'Default', etc. Null when the
            // user landed here without a NextAuth redirect.
            error: error ?? null,
            code: code ?? null,
            cfRay: h.get('cf-ray') ?? null,
            userAgent: h.get('user-agent')?.slice(0, 200) ?? null,
            referer: h.get('referer') ?? null,
        });
    } catch {
        // Headers / logger unavailable — page still renders. Diagnostic only.
    }

    return (
        <main className="min-h-screen bg-stone-50 flex items-center justify-center px-4 py-8">
            <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-stone-200 p-8 text-center">
                <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-stone-100 flex items-center justify-center text-stone-500">
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" strokeLinecap="round" />
                        <line x1="12" y1="16" x2="12.01" y2="16" strokeLinecap="round" />
                    </svg>
                </div>
                <h1 className="text-xl font-semibold text-stone-900 mb-2">
                    Ocurrió un error inesperado
                </h1>
                <p className="text-stone-600 text-sm leading-relaxed">
                    Por favor intentá nuevamente más tarde.
                </p>
                <AuthErrorReportForm />
            </div>
        </main>
    );
}
