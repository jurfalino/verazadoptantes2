/**
 * Per-request read-only mode for D1 — what makes "view as" (src/domain/viewAs.ts)
 * unable to save anything under the viewed user's name.
 *
 * The jwt callback marks the request when it resolves an active view-as claim.
 * Every request that acts as a user resolves the session first, so a write that
 * would be credited to the viewed user always comes after the mark.
 *
 * The mark is keyed by two per-request objects, and either one counts:
 *  - the promise `headers()` returns, which Next caches per request — present
 *    in pages, route handlers and server actions, locally and on Cloudflare;
 *  - on Cloudflare, the ExecutionContext, which next-on-pages keeps per request
 *    in AsyncLocalStorage. It is what still matches inside `waitUntil` /
 *    runAfterResponse work. Not used in `next dev`: the dev platform hands
 *    every request the SAME ctx object, so marking it would lock the server.
 */

import { getRequestContext } from '@cloudflare/next-on-pages';
import { headers } from 'next/headers';
import { isReadOnlySql } from '@/domain/viewAs';

export const READ_ONLY_ERROR_NAME = 'ViewAsReadOnlyError';

export class ViewAsReadOnlyError extends Error {
    constructor() {
        super('Read-only: you are viewing the app as another user. Exit "view as" to make changes.');
        this.name = READ_ONLY_ERROR_NAME;
    }
}

const readOnlyRequests = new WeakSet<object>();

function requestKeys(): object[] {
    const keys: object[] = [];
    try {
        const h = headers();
        if (h && typeof h === 'object') keys.push(h);
    } catch { /* outside a request (build, middleware, background work) */ }
    if (process.env.NODE_ENV === 'production') {
        try {
            const { ctx } = getRequestContext();
            if (ctx && typeof ctx === 'object') keys.push(ctx);
        } catch { /* not on Cloudflare */ }
    }
    return keys;
}

/**
 * Called by the jwt callback when a view-as claim is in force. Add-only: once
 * a request has acted as the viewed user, a later session resolution in the
 * same request (one that drops the claim on a D1 hiccup, say) must not make
 * it writable again — the request may already hold the viewed user's identity.
 */
export function markRequestReadOnly(): void {
    for (const key of requestKeys()) readOnlyRequests.add(key);
}

export function isRequestReadOnly(): boolean {
    return requestKeys().some(key => readOnlyRequests.has(key));
}

const REFUSED = Symbol('viewAsRefused');

/** A statement that fails when run — never a synchronous throw, so `.catch()` chains still see it. */
function refusedStatement(): D1PreparedStatement {
    const reject = () => Promise.reject(new ViewAsReadOnlyError());
    const stmt = { bind: () => stmt, run: reject, all: reject, first: reject, raw: reject, [REFUSED]: true };
    return stmt as unknown as D1PreparedStatement;
}

/**
 * Wraps a D1 binding so writes fail while the current request is read-only.
 * `isReadOnly` is injectable for tests; production checks the request mark.
 */
export function guardD1(d1: D1Database, isReadOnly: () => boolean = isRequestReadOnly): D1Database {
    return new Proxy(d1, {
        get(target, prop, receiver) {
            if (prop === 'prepare') {
                return (sql: string) =>
                    !isReadOnlySql(sql) && isReadOnly() ? refusedStatement() : target.prepare(sql);
            }
            if (prop === 'batch') {
                return (statements: D1PreparedStatement[]) =>
                    statements.some(s => (s as unknown as Record<symbol, unknown>)[REFUSED])
                        ? Promise.reject(new ViewAsReadOnlyError())
                        : target.batch(statements);
            }
            if (prop === 'exec') {
                // exec() runs several statements; nothing reads through it.
                return (sql: string) =>
                    isReadOnly() ? Promise.reject(new ViewAsReadOnlyError()) : target.exec(sql);
            }
            if (prop === 'withSession') {
                // Sessions hand out their own prepare(); refuse rather than leave a way around the guard.
                return () => { throw new Error('guardD1: withSession is not supported'); };
            }
            const value = Reflect.get(target, prop, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
}

/**
 * The raw binding, for the one write allowed in a read-only request: the
 * view-as start/stop audit row, which records the admin's own action
 * (src/lib/viewAsSession.ts). Nothing else may use this.
 */
export function unguardedD1ForViewAsAudit(): D1Database | null {
    try {
        return (getRequestContext().env as { DB?: D1Database }).DB ?? null;
    } catch {
        return null;
    }
}

const guardedBindings = new WeakMap<D1Database, D1Database>();

/** One guarded proxy per binding, so getDb()'s drizzle cache keeps hitting. */
export function guardedD1(d1: D1Database): D1Database {
    let guarded = guardedBindings.get(d1);
    if (!guarded) {
        guarded = guardD1(d1);
        guardedBindings.set(d1, guarded);
    }
    return guarded;
}
