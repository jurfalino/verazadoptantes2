'use server';

/**
 * Email OTP issuance — the "send me a code" half of email login. The verify
 * half lives in the `email-otp` Credentials provider (auth.config.ts) so the
 * sign-in goes through NextAuth's callbacks (adopter-login gate, profile
 * upsert, audit) like every other provider.
 *
 * Deliberately callable unauthenticated: the caller is by definition logged
 * out. Abuse is bounded by D1-backed rate limits on the codes table itself
 * (per-email min-gap + hourly cap, per-IP hourly cap) — no KV exists in this
 * project. Responses are uniform for every syntactically valid email; with
 * open sign-up there is no account-enumeration signal to hide.
 */

import { headers } from 'next/headers';
import { getDb } from './_db';
import { logger } from '@/lib/logger';
import { maskEmail } from '@/lib/dates';
import { getFeatureFlag } from '@/config/features';
import { resolveEmailConfig } from '@/lib/emailConfig';
import { sendEmailViaResend, buildOtpEmail, type EmailLocale } from '@/lib/email';
import {
    normalizeOtpEmail, generateOtpCode, hashOtpCode, resolveAuthSecret,
    OTP_TTL_MS, OTP_MIN_GAP_MS, OTP_HOURLY_MAX, OTP_IP_HOURLY_MAX,
} from '@/lib/otp';
import {
    recentSendTimes, countRecentByIp, retireActiveOtps, purgeOldOtps, insertOtp, retireOtp,
} from '@/lib/otpStore';

export type RequestEmailOtpResult =
    | { success: true }
    | {
        success: false;
        error: 'disabled' | 'invalid_email' | 'rate_limited' | 'send_failed';
        retryAfterSec?: number;
        errorId?: string;
    };

const HOUR_MS = 60 * 60_000;
const PURGE_AFTER_MS = 24 * HOUR_MS;

export async function requestEmailOtp(emailRaw: string, locale: string): Promise<RequestEmailOtpResult> {
    if (!(await getFeatureFlag('ENABLE_EMAIL_OTP'))) {
        return { success: false, error: 'disabled' };
    }

    const email = normalizeOtpEmail(emailRaw || '');
    if (!email) return { success: false, error: 'invalid_email' };

    let requestIp: string | null = null;
    try {
        const h = await headers();
        requestIp = h.get('cf-connecting-ip') || null;
    } catch { /* headers() unavailable outside request context */ }

    try {
        const db = await getDb();
        if (!db) {
            const errorId = logger.error('requestEmailOtp: DB unavailable', undefined, { email: maskEmail(email) });
            return { success: false, error: 'send_failed', errorId };
        }

        const now = new Date();

        // Rate limits, all D1-enforced on the codes table itself. One query
        // covers the per-email min-gap and hourly cap.
        const sends = await recentSendTimes(db, email, new Date(now.getTime() - HOUR_MS));
        if (sends[0] && now.getTime() - sends[0].getTime() < OTP_MIN_GAP_MS) {
            const retryAfterSec = Math.ceil((OTP_MIN_GAP_MS - (now.getTime() - sends[0].getTime())) / 1000);
            return { success: false, error: 'rate_limited', retryAfterSec };
        }
        if (sends.length >= OTP_HOURLY_MAX) {
            return { success: false, error: 'rate_limited' };
        }
        if (requestIp && await countRecentByIp(db, requestIp, new Date(now.getTime() - HOUR_MS)) >= OTP_IP_HOURLY_MAX) {
            return { success: false, error: 'rate_limited' };
        }

        // Opportunistic hygiene (also clears request_ip PII with the rows),
        // then make the new code the only outstanding one for this email.
        await purgeOldOtps(db, new Date(now.getTime() - PURGE_AFTER_MS));
        await retireActiveOtps(db, email, now);

        const code = generateOtpCode();
        const codeId = crypto.randomUUID();
        await insertOtp(db, {
            id: codeId,
            email,
            codeHash: await hashOtpCode(code, resolveAuthSecret()),
            createdAt: now,
            expiresAt: new Date(now.getTime() + OTP_TTL_MS),
            requestIp,
        });

        // appConfig row first (admin-settable without a deploy), env fallback.
        const { apiKey, from } = await resolveEmailConfig(db);

        if (!apiKey) {
            if (process.env.NODE_ENV !== 'production') {
                // Local dev / e2e: no Resend needed — the code row exists, tests
                // seed a known hash over it. Never log the code itself.
                logger.info('requestEmailOtp: no RESEND_API_KEY, send skipped (dev)', { email: maskEmail(email) });
                return { success: true };
            }
            const errorId = logger.error('requestEmailOtp: RESEND_API_KEY not configured', undefined, { email: maskEmail(email) });
            await retireOtp(db, codeId, new Date());
            return { success: false, error: 'send_failed', errorId };
        }

        const emailLocale: EmailLocale = locale === 'en' || locale === 'pt' ? locale : 'es';
        const message = buildOtpEmail(code, emailLocale, Math.round(OTP_TTL_MS / 60_000));
        const sent = await sendEmailViaResend({ apiKey, from, to: email, ...message });
        if (!sent.ok) {
            // The user must know the code isn't coming — retire it and be honest.
            await retireOtp(db, codeId, new Date());
            return { success: false, error: 'send_failed', errorId: sent.errorId };
        }

        logger.info('requestEmailOtp: code sent', { email: maskEmail(email) });
        return { success: true };
    } catch (e) {
        const errorId = logger.error('requestEmailOtp failed', e, { email: maskEmail(email) });
        return { success: false, error: 'send_failed', errorId };
    }
}
