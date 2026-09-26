/**
 * Writes for the "Quedó pendiente" asks. Kept out of `src/app/actions/` on
 * purpose: these run from inside other server work (a search, a saved record),
 * and exporting them from a `'use server'` module would also publish them as
 * server actions any client could call.
 */

import { pendingSearches } from '@/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { logger } from '@/lib/logger';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

/** Longest query worth keeping; anything beyond this is a paste, not a search. */
const MAX_QUERY_LENGTH = 200;

/**
 * Remember a search so the homepage can ask what came of it. Best-effort: a
 * failure here must never cost the rescuer their search results.
 */
export async function recordPendingSearch(
    db: Db,
    { userEmail, query, adopterId }: { userEmail: string; query: string; adopterId?: string | null },
): Promise<void> {
    const trimmed = (query || '').trim();
    if (!db || !userEmail || userEmail === 'unknown' || !trimmed) return;
    try {
        await db.insert(pendingSearches).values({
            id: crypto.randomUUID(),
            userEmail,
            query: trimmed.slice(0, MAX_QUERY_LENGTH),
            adopterId: adopterId ?? null,
            createdAt: new Date(),
        });
    } catch (e) {
        logger.warn('recordPendingSearch: insert failed', {
            user: userEmail,
            adopterId: adopterId ?? null,
            error: e instanceof Error ? e.message : String(e),
        });
    }
}

/**
 * Close every open ask this rescuer has about an adopter, because they just
 * recorded something about them somewhere else. Without this the homepage
 * would ask about work already done.
 */
export async function closePendingSearchesForAdopter(
    db: Db,
    userEmail: string,
    adopterId: string,
): Promise<void> {
    if (!db || !userEmail || userEmail === 'unknown' || !adopterId) return;
    try {
        await db.update(pendingSearches)
            .set({ resolvedAt: new Date(), resolution: 'recorded' })
            .where(and(
                eq(pendingSearches.userEmail, userEmail),
                eq(pendingSearches.adopterId, adopterId),
                isNull(pendingSearches.resolvedAt),
            ));
    } catch (e) {
        logger.warn('closePendingSearchesForAdopter: update failed', {
            user: userEmail,
            adopterId,
            error: e instanceof Error ? e.message : String(e),
        });
    }
}
