/**
 * The open «Reportar inexactitud» reports on a profile, for the banner the
 * owner team sees there (H4): «Reportaron información incorrecta (n)», one line
 * per report. The profile is their home — the `inaccuracy_reported` notice is
 * only a shortcut to it, so deleting the notice loses nothing.
 *
 * A plain server module, NOT 'use server': it returns who reported and what
 * they wrote, so it is never a browser endpoint. The page decides who sees it
 * (canSeeInaccuracyReports) before anything reaches the client.
 */
import { and, desc, eq } from 'drizzle-orm';
import { dataRequests } from '@/db/schema';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { noticeDetails } from '@/lib/inaccuracyReportNotices';

/** At most this many lines in the banner (one bounded query). */
export const PENDING_INACCURACY_REPORTS_MAX = 20;

export interface PendingInaccuracyReport {
    id: string;
    /** The reporter's display name, as resolved when they reported (what the notice says). */
    reporterName: string;
    /** Epoch milliseconds, or null when unknown. */
    createdAt: number | null;
    /** What they wrote, cut as the notice cuts it; undefined when they wrote nothing. */
    details?: string;
}

/**
 * Newest first. Fails closed to [] (logged): a read error never fabricates a
 * report, and the page still renders.
 */
export async function loadPendingInaccuracyReports(adopterId: string): Promise<PendingInaccuracyReport[]> {
    try {
        const db = await getDb();
        if (!db) return [];
        const rows = await db.select({
            id: dataRequests.id,
            requesterName: dataRequests.requesterName,
            createdAt: dataRequests.createdAt,
            details: dataRequests.details,
        }).from(dataRequests)
            .where(and(
                eq(dataRequests.adopterId, adopterId),
                eq(dataRequests.requestType, 'inaccuracy'),
                eq(dataRequests.status, 'pending'),
            ))
            .orderBy(desc(dataRequests.createdAt))
            .limit(PENDING_INACCURACY_REPORTS_MAX) as Array<{ id: string; requesterName: string | null; createdAt: Date | null; details: string | null }>;
        return rows.map(r => {
            const details = noticeDetails(r.details);
            return {
                id: r.id,
                reporterName: r.requesterName?.trim() ?? '',
                createdAt: r.createdAt instanceof Date && !Number.isNaN(r.createdAt.getTime()) ? r.createdAt.getTime() : null,
                ...(details ? { details } : {}),
            };
        });
    } catch (e) {
        logger.warn('loadPendingInaccuracyReports: D1 fallback hit', { adopterId, error: e instanceof Error ? e.message : String(e) });
        return [];
    }
}
