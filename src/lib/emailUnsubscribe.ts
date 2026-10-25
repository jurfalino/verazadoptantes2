/**
 * Signed one-click unsubscribe links for notification emails. The signature
 * is an HMAC over email + category, so a link can only switch off the one
 * category it was issued for. Always-on categories are never unsubscribable.
 */
import { ALWAYS_ON_CATEGORIES, EMAIL_CATEGORIES, type EmailCategory } from '@/domain/emailCategories';
import { hashOtpCode } from '@/lib/otp';

function payload(email: string, category: string): string {
    return `unsub:v1:${email.toLowerCase()}:${category}`;
}

export async function signUnsubscribe(email: string, category: EmailCategory, secret: string): Promise<string> {
    return hashOtpCode(payload(email, category), secret);
}

/** Compares without short-circuiting on the first differing char. */
function constantTimeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

/** The category when it may be unsubscribed from, else null. */
export function unsubscribableCategory(category: string): EmailCategory | null {
    const c = EMAIL_CATEGORIES.find((x) => x === category);
    if (!c || ALWAYS_ON_CATEGORIES.has(c)) return null;
    return c;
}

export async function verifyUnsubscribe(email: string, category: string, sig: string, secret: string): Promise<boolean> {
    const c = unsubscribableCategory(category);
    if (!c || !email || !sig) return false;
    const expected = await signUnsubscribe(email, c, secret);
    return constantTimeEqual(expected, sig);
}

export async function unsubscribeUrl(baseUrl: string, email: string, category: EmailCategory, secret: string): Promise<string> {
    const s = await signUnsubscribe(email, category, secret);
    const q = new URLSearchParams({ e: email, c: category, s });
    return `${baseUrl}/email/unsubscribe?${q.toString()}`;
}
