/**
 * Client-side error reporting helper. Posts to /api/log-client-error
 * which logs to Axiom and returns the canonical errorId. Callers display
 * that ID to the user — same ID, same Axiom row, by construction.
 *
 * Includes a small in-memory dedup cache so a noisy library or extension
 * can't flood the endpoint: identical (message, stack first line, source)
 * tuples within 30s reuse the prior id without a network call.
 */

import { extractErrorId } from '@/lib/errorUtils';

interface ReportInput {
    errorId?: string;       // pre-generated id; the server uses it verbatim so the user-visible id matches the Axiom row
    message: string;
    stack?: string;
    source: string;
    digest?: string;
    componentStack?: string;
    extra?: Record<string, unknown>;
    /** 'warn' for self-recovered conditions that get logged but not surfaced. */
    level?: 'warn' | 'error';
}

const dedupCache = new Map<string, { id: string; ts: number }>();
const DEDUP_TTL_MS = 30_000;
const MAX_CACHE = 50;

function dedupKey(input: ReportInput): string {
    const stackLine = input.stack?.split('\n')[0] || '';
    return `${input.source}|${input.message}|${stackLine}`;
}

export async function reportClientError(input: ReportInput): Promise<string | undefined> {
    if (typeof window === 'undefined') return undefined;

    const key = dedupKey(input);
    const now = Date.now();
    const cached = dedupCache.get(key);
    if (cached && now - cached.ts < DEDUP_TTL_MS) {
        return cached.id;
    }

    try {
        const res = await fetch('/api/log-client-error', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                errorId: input.errorId,
                message: input.message,
                stack: input.stack,
                source: input.source,
                digest: input.digest,
                componentStack: input.componentStack,
                url: window.location.href,
                userAgent: navigator.userAgent,
                extra: input.extra,
                level: input.level,
            }),
        });
        if (!res.ok) return undefined;
        const data = (await res.json()) as { errorId?: string };
        if (data.errorId) {
            if (dedupCache.size >= MAX_CACHE) {
                const firstKey = dedupCache.keys().next().value;
                if (firstKey) dedupCache.delete(firstKey);
            }
            dedupCache.set(key, { id: data.errorId, ts: now });
            return data.errorId;
        }
        return undefined;
    } catch {
        return undefined;
    }
}

/**
 * The id to show a user in an error toast — always a real one.
 *
 * `extractErrorId` only finds an id a server action embedded in its message. A
 * client-side throw, or a server action error that Next redacted in production,
 * has none — so `toast.error(title, desc, extractErrorId(e))` rendered a toast
 * with NO code and reported the failure NOWHERE. 49 call sites did that, which
 * is why a user-reported toast on 2026-09-07 left no trace in Axiom at all.
 *
 * Returns synchronously so it can be passed straight to `toast.error`, and
 * fires the report in the background under that same id — the same contract
 * ClientErrorReporter uses, so the id the user reads matches the Axiom row.
 */
export function resolveErrorId(error: unknown, source: string): string {
    const existing = extractErrorId(error);
    if (existing) return existing;

    const errorId = crypto.randomUUID().slice(0, 8);
    void reportClientError({
        errorId,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        source,
    });
    return errorId;
}
