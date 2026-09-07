/**
 * Outbound email via Resend's HTTP API — leaf module.
 *
 * No getDb/schema imports: config (apiKey, from) is passed in by the caller,
 * which resolves it appConfig-row-first per the telegram.ts pattern. Keeping
 * this a leaf means the followup-cron Worker can import it later without
 * violating its pure-modules-only discipline.
 *
 * Privacy: recipient emails are masked in logs; message bodies (which carry
 * the OTP code) are never logged.
 */

import { logger } from '@/lib/logger';
import { maskEmail } from '@/lib/dates';

export type EmailLocale = 'en' | 'es' | 'pt';

export interface SendEmailOptions {
    apiKey: string;
    from: string;
    to: string;
    subject: string;
    html: string;
    text: string;
}

export type SendEmailResult = { ok: true } | { ok: false; errorId: string };

export async function sendEmailViaResend(opts: SendEmailOptions): Promise<SendEmailResult> {
    const { apiKey, from, to, subject, html, text } = opts;
    try {
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ from, to, subject, html, text }),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            const errorId = logger.error('sendEmailViaResend: Resend API rejected send', undefined, {
                to: maskEmail(to),
                status: res.status,
                // Resend error bodies describe the API problem (bad domain,
                // quota), never our message content.
                apiError: body.slice(0, 300),
            });
            return { ok: false, errorId };
        }
        return { ok: true };
    } catch (e) {
        const errorId = logger.error('sendEmailViaResend: request threw', e, { to: maskEmail(to) });
        return { ok: false, errorId };
    }
}

const DURATION_UNITS: Record<EmailLocale, { hour: string; hours: string; minute: string; minutes: string }> = {
    es: { hour: 'hora', hours: 'horas', minute: 'minuto', minutes: 'minutos' },
    en: { hour: 'hour', hours: 'hours', minute: 'minute', minutes: 'minutes' },
    pt: { hour: 'hora', hours: 'horas', minute: 'minuto', minutes: 'minutos' },
};

/**
 * "1 hora" / "1 hour" for whole hours, "10 minutos" otherwise — a code that
 * lasts an hour should say so, not "60 minutos". Anything not a round hour
 * (say 90) stays in minutes rather than inventing "1,5 horas".
 */
export function formatDuration(totalMinutes: number, locale: EmailLocale): string {
    const units = DURATION_UNITS[locale] ?? DURATION_UNITS.es;
    if (totalMinutes >= 60 && totalMinutes % 60 === 0) {
        const hours = totalMinutes / 60;
        return `${hours} ${hours === 1 ? units.hour : units.hours}`;
    }
    return `${totalMinutes} ${totalMinutes === 1 ? units.minute : units.minutes}`;
}

const OTP_COPY: Record<EmailLocale, { subject: string; greeting: string; expires: (duration: string) => string; ignore: string }> = {
    es: {
        subject: 'Tu código de acceso a BuenAdoptante',
        greeting: 'Usá este código para iniciar sesión en BuenAdoptante:',
        expires: (d) => `El código vence en ${d}.`,
        ignore: 'Si no pediste este código, podés ignorar este correo.',
    },
    en: {
        subject: 'Your BuenAdoptante sign-in code',
        greeting: 'Use this code to sign in to BuenAdoptante:',
        expires: (d) => `The code expires in ${d}.`,
        ignore: "If you didn't request this code, you can ignore this email.",
    },
    pt: {
        subject: 'Seu código de acesso ao BuenAdoptante',
        greeting: 'Use este código para entrar no BuenAdoptante:',
        expires: (d) => `O código expira em ${d}.`,
        ignore: 'Se você não pediu este código, pode ignorar este e-mail.',
    },
};

/**
 * Trilingual OTP email. Copy lives here (server-side), NOT in
 * src/i18n/locales/* — those are client bundles and must never see codes
 * or grow server-only strings.
 *
 * ttlMinutes is passed in (from OTP_TTL_MS) instead of being written into the
 * copy, so the stated expiry can never disagree with the enforced one.
 */
export function buildOtpEmail(code: string, locale: EmailLocale, ttlMinutes: number): { subject: string; html: string; text: string } {
    const safeLocale: EmailLocale = OTP_COPY[locale] ? locale : 'es';
    const copy = OTP_COPY[safeLocale];
    const expires = copy.expires(formatDuration(ttlMinutes, safeLocale));
    const html = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1c1917;">
  <h2 style="color:#134e4a;margin:0 0 16px;">BuenAdoptante</h2>
  <p style="margin:0 0 20px;">${copy.greeting}</p>
  <p style="font-family:ui-monospace,monospace;font-size:32px;font-weight:700;letter-spacing:8px;background:#f0fdfa;border-radius:12px;padding:16px 24px;text-align:center;margin:0 0 20px;color:#134e4a;">${code}</p>
  <p style="margin:0 0 8px;font-size:14px;color:#57534e;">${expires}</p>
  <p style="margin:0;font-size:14px;color:#57534e;">${copy.ignore}</p>
</div>`;
    const text = `${copy.greeting}\n\n${code}\n\n${expires}\n${copy.ignore}\n`;
    return { subject: copy.subject, html, text };
}
