export const runtime = 'edge';
import AuthErrorReportForm from '@/components/AuthErrorReportForm';

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
 */
export default function AuthErrorPage() {
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
