/**
 * Per-request read-only mode for D1 — what makes "view as" (src/domain/viewAs.ts)
 * unable to save anything under the viewed user's name.
 *
 * The jwt callback marks the request when it resolves an active view-as claim.
 * Every request that acts as a user resolves the session first, so a write that
 * would be credited to the viewed user always comes after the mark.
 *
 * The mark is keyed by the Cloudflare ExecutionContext, which next-on-pages
 * keeps per request in AsyncLocalStorage — so it still holds inside
 * `waitUntil` / runAfterResponse work, where cookies and headers are already
 * gone. In local dev (no Cloudflare context) it is keyed by the request's
 * headers object instead, and getDb() applies it when it hands out the DB.
 */

import { getRequestContext } from '@cloudflare/next-on-pages';
import { isReadOnlySql } from '@/domain/viewAs';

export const READ_ONLY_ERROR_NAME = 'ViewAsReadOnlyError';

export class ViewAsReadOnlyError extends Error {
    constructor() {
        super('Read-only: you are viewing the app as another user. Exit "view as" to make changes.');
        this.name = READ_ONLY_ERROR_NAME;
    }
}

const readOnlyRequests = new WeakSet<object>();

function cloudflareRequestKey(): object | null {
    try {
        const { ctx } = getRequestContext();
        return ctx && typeof ctx === 'object' ? ctx : null;
    } catch {
        return null;
    }
}

async function requestKey(): Promise<object | null> {
    const cf = cloudflareRequestKey();
    if (cf) return cf;
    try {
        const { headers } = await import('next/headers');
        return await headers();
    } catch {
        return null;
    }
}

/** Called by the jwt callback with the outcome of every session resolution. */
export async function setRequestReadOnly(readOnly: boolean): Promise<void> {
    const key = await requestKey();
    if (!key) return;
    if (readOnly) readOnlyRequests.add(key);
    else readOnlyRequests.delete(key);
}

export async function isRequestReadOnly(): Promise<boolean> {
    const key = await requestKey();
    return !!key && readOnlyRequests.has(key);
}

function isRequestReadOnlyNow(): boolean {
    const key = cloudflareRequestKey();
    return !!key && readOnlyRequests.has(key);
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
export function guardD1(d1: D1Database, isReadOnly: () => boolean = isRequestReadOnlyNow): D1Database {
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
