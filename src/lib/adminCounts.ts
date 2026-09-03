import { getDb } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { logger } from '@/lib/logger';

/**
 * Actionable-item counts for the admin sidebar badges.
 *
 * ONE query, not one per counter. The admin layout already spends several D1
 * calls on `auth()` + role resolution, and a Worker gets 50 subrequests and
 * 10ms CPU on the Free plan — so every avoidable round trip on a path that
 * runs for *every* admin page view is worth collapsing.
 *
 * Deliberately narrow. A badge earns attention by being usually zero; a number
 * that is always present becomes wallpaper and stops being read. Two counters
 * qualify today:
 *
 *   - data requests   — legal response deadlines, and rare (3 ever in prod)
 *   - PII requests    — someone is blocked waiting on an approval
 *
 * Two were considered and rejected:
 *
 *   - pending duplicate candidates — 785 in production. That is a backlog to
 *     work through, not a to-do that appeared; badging it would show a large
 *     number permanently and train the eye to ignore all the badges.
 *   - flagged content — `adopter_flags` has no status column, so there is no
 *     "pending" to count. Adding one is a schema change, not a badge.
 */
export interface AdminCounts {
    dataRequests: number;
    piiRequests: number;
}

const EMPTY: AdminCounts = { dataRequests: 0, piiRequests: 0 };

export async function getAdminCounts(): Promise<AdminCounts> {
    try {
        const db = await getDb();
        if (!db) return EMPTY;

        const row = await db.get(sql`
            SELECT
              (SELECT COUNT(*) FROM data_requests WHERE status = 'pending') AS dr,
              (SELECT COUNT(*) FROM pii_access_requests WHERE status = 'pending') AS pii
        `) as { dr?: number; pii?: number } | undefined;

        return {
            dataRequests: Number(row?.dr ?? 0),
            piiRequests: Number(row?.pii ?? 0),
        };
    } catch (e) {
        // A badge must never take down the admin console. Zero renders no badge,
        // which is the same as "nothing to do" — acceptable degradation for a
        // decoration, and logged so it does not fail silently forever.
        logger.warn('Admin counts unavailable', {
            error: e instanceof Error ? e.message : String(e),
        });
        return EMPTY;
    }
}
