/**
 * Email OTP primitives — pure WebCrypto only.
 *
 * This module is imported by the `email-otp` Credentials provider in
 * auth.config.ts, which lands in the middleware edge bundle (middleware.ts
 * dynamically imports @/auth for protected routes). Nothing here may pull
 * Node-only APIs: crypto.getRandomValues / crypto.subtle exclusively.
 *
 * Codes are never stored or logged in plaintext — only the HMAC-SHA-256
 * keyed with AUTH_SECRET. Plain SHA-256 would let anyone with a D1 dump
 * brute-force the 10^6 code space offline in microseconds; keying with
 * AUTH_SECRET makes stored hashes useless without the secret.
 */

import { getRequestContext } from '@cloudflare/next-on-pages';

export const OTP_TTL_MS = 10 * 60_000; // code lifetime
export const OTP_MAX_ATTEMPTS = 5; // failed verifies before the code is retired
export const OTP_MIN_GAP_MS = 60_000; // min gap between sends per email
export const OTP_HOURLY_MAX = 5; // sends per email per hour
export const OTP_IP_HOURLY_MAX = 15; // sends per IP per hour

// Deliberately minimal: real validation is the code arriving in the inbox.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trim + lowercase; null when the result doesn't look like an email. */
export function normalizeOtpEmail(raw: string): string | null {
    const email = raw.trim().toLowerCase();
    if (!email || email.length > 254 || !EMAIL_SHAPE.test(email)) return null;
    return email;
}

/**
 * 6 random digits via rejection sampling: values >= the largest multiple of
 * 10^6 below 2^32 are redrawn, so `% 1_000_000` carries no modulo bias.
 */
export function generateOtpCode(): string {
    const limit = 4_294_000_000; // 4294 * 10^6
    const buf = new Uint32Array(1);
    let v: number;
    do {
        crypto.getRandomValues(buf);
        v = buf[0];
    } while (v >= limit);
    return String(v % 1_000_000).padStart(6, '0');
}

/** Hex HMAC-SHA-256 of the code, keyed with AUTH_SECRET. */
export async function hashOtpCode(code: string, secret: string): Promise<string> {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(code));
    return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * AUTH_SECRET from the Cloudflare runtime env, falling back to process.env
 * (local dev). Throws when absent — a missing secret must fail the OTP flow
 * loudly, never verify against an empty-keyed HMAC.
 */
export function resolveAuthSecret(): string {
    let secret = '';
    try {
        const ctx = getRequestContext();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const env = (ctx?.env ?? {}) as Record<string, any>;
        if (typeof env.AUTH_SECRET === 'string' && env.AUTH_SECRET) secret = env.AUTH_SECRET;
    } catch { /* not in Cloudflare context */ }
    if (!secret) secret = process.env.AUTH_SECRET || '';
    if (!secret) throw new Error('AUTH_SECRET is not configured');
    return secret;
}
