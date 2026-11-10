/**
 * «Answer once, cleared everywhere» (Jon 2026-11-10): when a «¿Es la misma
 * persona?» pair is settled — merged, kept separate, a request answered or
 * cancelled, a declined row hidden — the bell notices about that pair stop
 * reading as unread, for everyone who got one. The home card, «Pendientes de
 * revisar» and the bell then agree on what's still waiting.
 *
 * Only `read` changes: a notice is never deleted, so the history stays.
 * Best-effort: a failure is logged and never undoes the answer.
 */
import { and, eq, or, sql, type SQL } from 'drizzle-orm';
import { notifications } from '@/db/schema';
import type { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** Every notice type about a pair (merge requests carry primaryId/secondaryId; flags adopterId/targetAdopterId). */
export const PAIR_NOTICE_TYPES = ['merge_request', 'duplicate_flagged', 'merge_request_resolved'] as const;
export type PairNoticeType = typeof PAIR_NOTICE_TYPES[number];

// CASE, not `json_valid(...) AND …`: SQLite doesn't promise to test json_valid first, and json_extract raises on invalid JSON.
const field = (path: string) => sql`CASE WHEN json_valid(${notifications.metadata}) THEN json_extract(${notifications.metadata}, ${path}) END`;

/** The notice is about the pair {a, b}, in either orientation, under either naming. */
function aboutPair(a: string, b: string): SQL {
    const both = (x: string, y: string) => or(
        and(sql`${field('$.primaryId')} = ${x}`, sql`${field('$.secondaryId')} = ${y}`),
        and(sql`${field('$.adopterId')} = ${x}`, sql`${field('$.targetAdopterId')} = ${y}`),
    )!;
    return or(both(a, b), both(b, a))!;
}

/**
 * A merge absorbed `profileId`: every pair it was part of is moot (its rows leave «Pendientes de
 * revisar»), so every pair notice naming it is read, for everyone.
 */
export async function clearProfilePairNotices(db: Db, profileId: string, ctx: Record<string, unknown> = {}): Promise<void> {
    if (!profileId) return;
    try {
        const names = (path: string) => sql`${field(path)} = ${profileId}`;
        await db.update(notifications)
            .set({ read: 1 })
            .where(and(
                eq(notifications.read, 0),
                or(...PAIR_NOTICE_TYPES.map(t => eq(notifications.type, t)))!,
                or(names('$.primaryId'), names('$.secondaryId'), names('$.adopterId'), names('$.targetAdopterId'))!,
            ));
    } catch (e) {
        logger.warn('clearProfilePairNotices: notices left unread', {
            ...ctx, profileId, error: e instanceof Error ? e.message : String(e),
        });
    }
}

export async function clearPairNotices(db: Db, a: string, b: string, opts: {
    types: readonly PairNoticeType[];
    /** Only this person's notices (e.g. they hid the pair); everyone's when absent. */
    userId?: string;
    ctx?: Record<string, unknown>;
}): Promise<void> {
    if (!a || !b || a === b || opts.types.length === 0) return;
    try {
        // One scalar per type, OR-ed (never a bound array: D1 doesn't expand IN).
        const ofType = or(...opts.types.map(t => eq(notifications.type, t)))!;
        await db.update(notifications)
            .set({ read: 1 })
            .where(and(
                eq(notifications.read, 0),
                ofType,
                aboutPair(a, b),
                ...(opts.userId ? [sql`lower(${notifications.userId}) = ${opts.userId.toLowerCase().trim()}`] : []),
            ));
    } catch (e) {
        logger.warn('clearPairNotices: pair notices left unread', {
            ...opts.ctx, primaryId: a, secondaryId: b, types: opts.types.join(','), userId: opts.userId,
            error: e instanceof Error ? e.message : String(e),
        });
    }
}
