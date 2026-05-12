'use client';

import { useState } from 'react';

/**
 * Client island on the auth-error page (v2.14.9-14). A real "report this
 * problem" form so the user — who in our case may be a blocked adopter
 * thinking the app is broken — has somewhere to vent. Submissions go to
 * `/api/error-report` and surface on /admin/blocked-logins for the operator.
 *
 * Intentionally simple: optional email, optional message, single submit.
 * No CAPTCHA, no rate limit at the field level (rate limiting belongs at
 * the API route or upstream WAF). Empty submissions are accepted; the row
 * still records timestamp + IP-hash + user-agent which is useful signal.
 */
export default function AuthErrorReportForm() {
    const [email, setEmail] = useState('');
    const [message, setMessage] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (submitted) {
        return (
            <div className="mt-6 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-center">
                <p className="text-sm text-emerald-900 font-medium">
                    Gracias, recibimos tu mensaje. Vamos a revisarlo.
                </p>
            </div>
        );
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        setError(null);
        try {
            const res = await fetch('/api/error-report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email.trim(), message: message.trim() }),
            });
            if (!res.ok) throw new Error('submit failed');
            setSubmitted(true);
        } catch {
            setError('No pudimos enviar el reporte. Intentá nuevamente.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="mt-6 space-y-3 text-left">
            <p className="text-xs text-stone-500 text-center">
                ¿Querés reportar el problema?
            </p>
            <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Tu email (opcional)"
                className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:border-teal-400 focus:ring-2 focus:ring-teal-100 outline-none transition-all"
                maxLength={200}
                autoComplete="email"
            />
            <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Contanos qué pasó…"
                className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:border-teal-400 focus:ring-2 focus:ring-teal-100 outline-none transition-all resize-none"
                rows={3}
                maxLength={2000}
            />
            {error && <p className="text-xs text-rose-700 text-center">{error}</p>}
            <button
                type="submit"
                disabled={submitting}
                className="w-full px-4 py-2 rounded-lg bg-stone-900 text-white text-sm font-semibold hover:bg-stone-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
                {submitting ? 'Enviando…' : 'Reportar problema'}
            </button>
        </form>
    );
}
