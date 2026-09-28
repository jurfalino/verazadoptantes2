'use server';

import { pendingSearches, adopters } from '@/db/schema';
import { and, desc, eq, gte, isNull } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { getDb, getUser } from './_db';
import { groupPendingSearches, isIdentified, type PendingAsk } from '@/domain/pendingSearches';

/** How far back the homepage asks, and how many asks it shows. */
const WINDOW_DAYS = 30;
const MAX_ASKS = 10;
/** Raw rows read before grouping — a rescuer's month of searches, bounded. */
const MAX_ROWS = 200;

/**
 * The open "¿qué pasó?" asks for the signed-in rescuer, one per person searched.
 * Returns [] for anyone logged out, and never throws: an empty deck is the right
 * failure mode for a homepage card.
 */
export async function getPendingAsks(): Promise<PendingAsk[]> {
    let user = 'unknown';
    try {
        user = await getUser();
    } catch {
        return [];
    }

    try {
        const db = await getDb();
        if (!db) return [];

        const cutoff = new Date(Date.now() - WINDOW_DAYS * 86400 * 1000);
        const rows = await db.select()
            .from(pendingSearches)
            .where(and(
                eq(pendingSearches.userEmail, user),
                isNull(pendingSearches.resolvedAt),
                gte(pendingSearches.createdAt, cutoff),
            ))
            .orderBy(desc(pendingSearches.createdAt))
            .limit(MAX_ROWS);

        const asks = groupPendingSearches(
            rows.map((r: typeof pendingSearches.$inferSelect) => ({
                id: r.id,
                query: r.query,
                createdAt: Math.floor(new Date(r.createdAt ?? new Date()).getTime() / 1000),
                adopterId: r.adopterId,
                matchConfidence: r.matchConfidence,
            })),
            { maxAgeDays: WINDOW_DAYS, limit: MAX_ASKS },
        );

        // D1 does not expand array parameters, so the names are fetched one by one.
        return await Promise.all(asks.map(async (ask) => {
            // Only a certain match may be named. A weak or absent one leaves the
            // ask about the words the rescuer typed, which is always true.
            const adopterId = ask.adopterId;
            if (!adopterId || !isIdentified(ask)) return { ...ask, adopterId: null, adopterName: null };
            const adopter = await db.select({ name: adopters.name, deletedAt: adopters.deletedAt })
                .from(adopters)
                .where(eq(adopters.id, adopterId))
                .get()
                .catch((e: unknown) => {
                    logger.warn('getPendingAsks: D1 fallback hit reading adopter name', {
                        user,
                        adopterId,
                        error: e instanceof Error ? e.message : String(e),
                    });
                    return null;
                });
            // Merged or deleted since the search: ask about what they typed instead.
            if (!adopter || adopter.deletedAt) return { ...ask, adopterId: null, adopterName: null };
            return { ...ask, adopterName: adopter.name };
        }));
    } catch (e) {
        logger.error('getPendingAsks failed', {
            user,
            error: e instanceof Error ? e.message : String(e),
        });
        return [];
    }
}

/**
 * Close the searches behind one ask. `recorded` when the rescuer answered it,
 * `dismissed` when they said nothing happened.
 */
export async function resolvePendingAsk(
    ids: string[],
    resolution: 'recorded' | 'dismissed',
): Promise<{ success: boolean }> {
    let user = 'unknown';
    try {
        user = await getUser();
        const db = await getDb();
        if (!db) throw new Error('No database');
        if (!Array.isArray(ids) || ids.length === 0) return { success: true };
        if (resolution !== 'recorded' && resolution !== 'dismissed') {
            throw new Error(`Unknown resolution: ${resolution}`);
        }

        // Own rows only — the id alone must never be enough to close someone
        // else's ask. D1 has no array expansion, so each id is its own update.
        await Promise.all(ids.slice(0, MAX_ASKS * 10).map((id) =>
            db.update(pendingSearches)
                .set({ resolvedAt: new Date(), resolution })
                .where(and(
                    eq(pendingSearches.id, id),
                    eq(pendingSearches.userEmail, user),
                    isNull(pendingSearches.resolvedAt),
                ))
                .catch((e: unknown) => {
                    logger.warn('resolvePendingAsk: D1 fallback hit closing one search', {
                        user, pendingSearchId: id, resolution,
                        error: e instanceof Error ? e.message : String(e),
                    });
                })
        ));

        logger.info('Pending ask resolved', { user, count: ids.length, resolution });
        return { success: true };
    } catch (e) {
        const errorId = logger.error('resolvePendingAsk failed', {
            user,
            count: Array.isArray(ids) ? ids.length : 0,
            resolution,
            error: e instanceof Error ? e.message : String(e),
        });
        throw new Error(`No pudimos actualizar la búsqueda pendiente (${errorId})`);
    }
}
