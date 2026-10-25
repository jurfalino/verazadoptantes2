/**
 * Closing stale merge requests. Its own module (imports only the schema,
 * drizzle and nothing that merges) so src/lib/adopterMerge.ts can call it after
 * every merge without importing src/lib/mergeRequests.ts, which imports
 * mergeAdopters — that would be a circular import.
 */

import { and, eq, or } from 'drizzle-orm';
import { mergeRequests } from '@/db/schema';
import type { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/**
 * A request that can still be answered: pending, or declined (an admin may
 * still approve it, spec D6). What a merge closes. (Filing a new request
 * dedupes against `pending` only — a declined one is not "already asked".)
 * Never `IN (…)` — D1 binds one value.
 */
export const openMergeRequestStatus = () =>
    or(eq(mergeRequests.status, 'pending'), eq(mergeRequests.status, 'declined'));

/**
 * Close every open request naming this profile on either side: once a profile
 * is absorbed by a merge the pair a request asked about no longer exists, and
 * nobody may accept it. Returns how many were closed. Throws on a DB error —
 * callers decide whether that is fatal.
 */
export async function closeRequestsForAdopter(db: Db, adopterId: string): Promise<number> {
    const closed = await db.update(mergeRequests)
        .set({ status: 'closed', resolvedAt: new Date() })
        .where(and(
            or(eq(mergeRequests.primaryId, adopterId), eq(mergeRequests.secondaryId, adopterId)),
            openMergeRequestStatus(),
        ))
        .returning({ id: mergeRequests.id });
    return closed.length;
}

/**
 * A profile was deleted (hard, or soft outside a merge): its open requests
 * close on their own (spec: "If either profile is merged or deleted by some
 * other path while a request is pending, the request closes on its own").
 * Best-effort — the delete stands either way; a failure is logged, and the
 * feed drops a request whose profiles are not both live regardless.
 */
export async function closeRequestsForDeletedAdopter(db: Db, adopterId: string, actor: string | null | undefined): Promise<void> {
    try {
        const closed = await closeRequestsForAdopter(db, adopterId);
        if (closed > 0) logger.info('closeRequestsForDeletedAdopter: closed', { adopterId, actor, closed });
    } catch (e) {
        logger.warn('closeRequestsForDeletedAdopter: open requests left open', {
            adopterId, actor, error: e instanceof Error ? e.message : String(e),
        });
    }
}

/**
 * Close every open request on this pair (either orientation): the pair was
 * settled some other way — «No, es alguien de su hogar» (D35) — and nobody
 * may approve a merge of two different people later. Returns how many were
 * closed. Throws on a DB error — callers decide whether that is fatal.
 */
export async function closeRequestsForPair(db: Db, a: string, b: string): Promise<number> {
    const closed = await db.update(mergeRequests)
        .set({ status: 'closed', resolvedAt: new Date() })
        .where(and(
            or(
                and(eq(mergeRequests.primaryId, a), eq(mergeRequests.secondaryId, b)),
                and(eq(mergeRequests.primaryId, b), eq(mergeRequests.secondaryId, a)),
            ),
            openMergeRequestStatus(),
        ))
        .returning({ id: mergeRequests.id });
    return closed.length;
}
