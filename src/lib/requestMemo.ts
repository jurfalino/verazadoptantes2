/**
 * Per-request memo (EM review 2026-11-10): one homepage load asked «who is
 * this?», «is she an admin?» and «who is on her team?» several times — each a
 * D1 round trip, ~180 ms from Argentina. Within ONE request the answer is
 * the same, so the first call's promise is reused.
 *
 * Keyed on the request's own headers object (next/headers), never on
 * module state or getRequestContext(): in dev that context is shared across
 * requests (see project memory), and a memo that leaked between requests
 * would answer for the wrong person. Outside a request (build, cron, tests)
 * there is nothing to key on, so nothing is memoized.
 *
 * A rejected promise is dropped, so a failure is retried, never remembered.
 */
import { headers } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';

const memo = new WeakMap<object, Map<string, Promise<unknown>>>();

async function requestKey(): Promise<object | null> {
    try {
        return await headers();
    } catch (e) {
        // Next's own control-flow errors (dynamic rendering bail-out, etc.) must propagate.
        unstable_rethrow(e);
        return null; // not inside a request
    }
}

export async function perRequest<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const req = await requestKey();
    if (!req) return fn();
    let m = memo.get(req);
    if (!m) { m = new Map(); memo.set(req, m); }
    const hit = m.get(key);
    if (hit) return hit as Promise<T>;
    const p = fn();
    m.set(key, p);
    p.catch(() => { m!.delete(key); });
    return p;
}
