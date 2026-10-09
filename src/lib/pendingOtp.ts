/**
 * Remembers an emailed login code across a page reload.
 *
 * In an in-app browser the visitor leaves for their mail app to read the code,
 * and Instagram/Facebook often reload the page when they come back. Without
 * this the login box is gone and the form restarts at "enter your email" with
 * the resend cooldown still running server-side. sessionStorage is per-tab, so
 * the code step only comes back in the browser that asked for it.
 */

const KEY = 'ba-login-otp-pending';
/** Longer than anyone takes to fetch a code, shorter than its 1 h validity. */
const PENDING_TTL_MS = 15 * 60 * 1000;

export interface PendingOtp {
    email: string;
    sentAt: number;
    returnPath: string;
}

export function savePendingOtp(pending: PendingOtp): void {
    try {
        sessionStorage.setItem(KEY, JSON.stringify(pending));
    } catch {
        // Storage blocked (private mode, quota): the form still works, it just
        // won't survive a reload — nothing to report.
    }
}

export function readPendingOtp(now: number = Date.now()): PendingOtp | null {
    try {
        const raw = sessionStorage.getItem(KEY);
        if (!raw) return null;
        const p = JSON.parse(raw) as Partial<PendingOtp>;
        if (typeof p.email !== 'string' || typeof p.sentAt !== 'number' || typeof p.returnPath !== 'string') return null;
        if (now - p.sentAt > PENDING_TTL_MS) {
            sessionStorage.removeItem(KEY);
            return null;
        }
        return { email: p.email, sentAt: p.sentAt, returnPath: p.returnPath };
    } catch {
        return null;
    }
}

export function clearPendingOtp(): void {
    try {
        sessionStorage.removeItem(KEY);
    } catch {
        // see savePendingOtp
    }
}
