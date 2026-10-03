/**
 * "View as" — an admin browsing the app as another user, read-only.
 *
 * The claim lives in the admin's own session token next to their real email,
 * never in place of it: `token.email` stays the admin, so dropping the claim is
 * all it takes to be yourself again. While the claim is active the session
 * reports the target user, and the database refuses every write for the request
 * (src/lib/readOnlyGuard.ts).
 *
 * Everything here is pure; the session wiring is in src/lib/viewAsSession.ts.
 */

/** A claim older than this is ignored, so a forgotten tab drops back to the admin. */
export const VIEW_AS_MAX_MS = 60 * 60 * 1000;

export interface ViewAsClaim {
    userId: string;
    email: string;
    name: string | null;
    image: string | null;
    /** ms since epoch */
    startedAt: number;
}

/** The claim if it is well-formed and not expired, else null. */
export function activeViewAs(claim: unknown, now: number): ViewAsClaim | null {
    if (!claim || typeof claim !== 'object') return null;
    const c = claim as Partial<ViewAsClaim>;
    if (typeof c.userId !== 'string' || !c.userId) return null;
    if (typeof c.email !== 'string' || !c.email) return null;
    if (typeof c.startedAt !== 'number' || !Number.isFinite(c.startedAt)) return null;
    if (c.startedAt > now || now - c.startedAt >= VIEW_AS_MAX_MS) return null;
    return {
        userId: c.userId,
        email: c.email,
        name: typeof c.name === 'string' ? c.name : null,
        image: typeof c.image === 'string' ? c.image : null,
        startedAt: c.startedAt,
    };
}

export type ViewAsRequest =
    | { kind: 'start'; userId: string }
    | { kind: 'stop' }
    | { kind: 'none' };

/**
 * Reads the payload of a session update. Anyone signed in can send one (the
 * client `update()` posts to /api/auth/session), so this only recognises the
 * shape; whether the caller may act on it is decideViewAsStart's job.
 */
export function parseViewAsRequest(payload: unknown): ViewAsRequest {
    if (!payload || typeof payload !== 'object' || !('viewAs' in payload)) return { kind: 'none' };
    const v = (payload as { viewAs: unknown }).viewAs;
    if (v === null) return { kind: 'stop' };
    if (v && typeof v === 'object' && typeof (v as { userId?: unknown }).userId === 'string') {
        const userId = (v as { userId: string }).userId.trim();
        if (userId) return { kind: 'start', userId };
    }
    return { kind: 'none' };
}

export type ViewAsRefusal = 'not_admin' | 'no_such_user' | 'self' | 'target_is_admin';

export function decideViewAsStart(input: {
    actorEmail: string | null | undefined;
    actorIsAdmin: boolean;
    target: { id: string; email: string; isAdmin: boolean } | null;
}): { ok: true } | { ok: false; reason: ViewAsRefusal } {
    if (!input.actorEmail || !input.actorIsAdmin) return { ok: false, reason: 'not_admin' };
    if (!input.target) return { ok: false, reason: 'no_such_user' };
    if (input.target.email.toLowerCase() === input.actorEmail.toLowerCase()) return { ok: false, reason: 'self' };
    if (input.target.isAdmin) return { ok: false, reason: 'target_is_admin' };
    return { ok: true };
}

/**
 * True only for statements that cannot change data. Anything not recognised is
 * treated as a write: a false "write" blocks one read while viewing as someone,
 * a false "read" would let a save through under their name.
 */
export function isReadOnlySql(sql: string): boolean {
    const s = sql
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/--[^\n]*/g, ' ')
        .trim()
        .toLowerCase();
    // A second statement after a `;` is not looked at, so it is not allowed.
    if (/;\s*\S/.test(s)) return false;
    if (/^(select|explain)\b/.test(s)) return true;
    if (/^with\b/.test(s)) return !/\b(insert|update|delete|replace)\b/.test(s);
    return false;
}
