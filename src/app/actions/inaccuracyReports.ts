'use server';

/**
 * «Ya lo corregí» on the profile's «Reportaron información incorrecta» banner
 * (H4): the owner team closes the open inaccuracy reports the banner showed on the profile they
 * fixed. Before, only an admin could close one (resolveDataRequest).
 *
 * Browser-callable: the session is the only actor. The server checks the same
 * audience the banner has (canSeeInaccuracyReports — owner, their team, admins
 * and moderators); anyone else, the reporter included, closes nothing. Each
 * report keeps who closed it (`resolved_by`), shown on /admin/data-requests.
 */
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { adopters, dataRequests } from '@/db/schema';
import { getDb, getUser, checkIsModeratorOrAdminAsync } from './_db';
import { logger, generateErrorId } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { isOrgMate } from '@/lib/orgMembership';
import { isRealActorEmail } from '@/lib/piiAccess';
import { canSeeInaccuracyReports } from '@/domain/inaccuracyReports';
import { PENDING_INACCURACY_REPORTS_MAX } from '@/lib/inaccuracyReports';

export type MarkInaccuracyReportsFixedResult =
    | { ok: true; resolved: number }
    | { ok: false; error: 'unauthenticated' | 'invalid' | 'not_found' | 'not_authorized' | 'failed'; errorId: string };

/**
 * `reportIds` = the lines the banner showed. Only those close (review I1): a
 * report filed after the page loaded, or past the banner's limit, stays open
 * for the admins instead of being closed unread.
 */
export async function markInaccuracyReportsFixed(adopterId: string, reportIds: string[]): Promise<MarkInaccuracyReportsFixedResult> {
    const id = typeof adopterId === 'string' ? adopterId.trim().slice(0, 64) : '';
    const ids = Array.isArray(reportIds)
        ? [...new Set(reportIds.filter((r): r is string => typeof r === 'string').map(r => r.trim().slice(0, 64)).filter(Boolean))].slice(0, PENDING_INACCURACY_REPORTS_MAX)
        : [];
    let actor: string | null = null;
    const refuse = (error: 'unauthenticated' | 'invalid' | 'not_found' | 'not_authorized') => {
        const errorId = generateErrorId();
        logger.warn('markInaccuracyReportsFixed: refused', { adopterId: id, actor, reason: error, errorId });
        return { ok: false as const, error, errorId };
    };
    try {
        try { actor = (await getUser()).trim().toLowerCase(); } catch { actor = null; /* anonymous: refused below */ }
        if (!isRealActorEmail(actor)) { actor = null; return refuse('unauthenticated'); }
        if (!id || ids.length === 0) return refuse('invalid');
        const db = await getDb();
        if (!db) throw new Error('No database');

        const profile = await db.select({ addedBy: adopters.addedBy, deletedAt: adopters.deletedAt })
            .from(adopters).where(eq(adopters.id, id)).get() as { addedBy: string | null; deletedAt: Date | null } | undefined;
        if (!profile || profile.deletedAt) return refuse('not_found');
        const [mate, staff] = await Promise.all([
            profile.addedBy ? isOrgMate(actor, profile.addedBy) : Promise.resolve(false),
            checkIsModeratorOrAdminAsync(actor),
        ]);
        if (!canSeeInaccuracyReports({ viewer: actor, owner: profile.addedBy, viewerIsOrgMateOfOwner: mate, viewerIsModeratorOrAdmin: staff })) {
            return refuse('not_authorized');
        }

        // One statement per shown report (D1: no IN (array); at most
        // PENDING_INACCURACY_REPORTS_MAX), each scoped to this profile's OPEN
        // inaccuracy reports: a closed one keeps who closed it, a deletion request
        // or another profile's report is never touched.
        const now = new Date();
        const closed = (await Promise.all(ids.map(reportId => db.update(dataRequests)
            .set({ status: 'resolved', resolvedAt: now, resolvedBy: actor })
            .where(and(
                eq(dataRequests.id, reportId),
                eq(dataRequests.adopterId, id),
                eq(dataRequests.requestType, 'inaccuracy'),
                eq(dataRequests.status, 'pending'),
            ))
            .returning({ id: dataRequests.id }) as Promise<Array<{ id: string }>>))).flat();

        logger.info('markInaccuracyReportsFixed: closed', { adopterId: id, actor, resolved: closed.length });
        if (closed.length > 0) {
            await logAudit({ userEmail: actor, action: 'inaccuracy_reports_resolved', target: id, details: { requestIds: closed.map(r => r.id) } });
        }
        revalidatePath(`/adopter/${id}`);
        revalidatePath('/admin/data-requests');
        return { ok: true, resolved: closed.length };
    } catch (e) {
        const errorId = logger.error('markInaccuracyReportsFixed failed', e, { adopterId: id, actor });
        return { ok: false, error: 'failed', errorId };
    }
}
