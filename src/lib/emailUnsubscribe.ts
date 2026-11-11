/**
 * Signed one-click unsubscribe links for notification emails. The signature
 * is an HMAC over email + «Avisos» row key, so a link can only switch off the
 * one row it was issued for. The rows someone waits on («Siempre») are never
 * unsubscribable (src/domain/noticeRows.ts: unsubscribableRow).
 */
import { unsubscribableRow, type SwitchableRowKey } from '@/domain/noticeRows';
import { hashOtpCode } from '@/lib/otp';

function payload(email: string, row: string): string {
    return `unsub:v1:${email.toLowerCase()}:${row}`;
}

export async function signUnsubscribe(email: string, row: SwitchableRowKey, secret: string): Promise<string> {
    return hashOtpCode(payload(email, row), secret);
}

/** Compares without short-circuiting on the first differing char. */
function constantTimeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

export async function verifyUnsubscribe(email: string, row: string, sig: string, secret: string): Promise<boolean> {
    const r = unsubscribableRow(row);
    if (!r || !email || !sig) return false;
    const expected = await signUnsubscribe(email, r, secret);
    return constantTimeEqual(expected, sig);
}

export async function unsubscribeUrl(baseUrl: string, email: string, row: SwitchableRowKey, secret: string): Promise<string> {
    const s = await signUnsubscribe(email, row, secret);
    const q = new URLSearchParams({ e: email, c: row, s });
    return `${baseUrl}/email/unsubscribe?${q.toString()}`;
}
