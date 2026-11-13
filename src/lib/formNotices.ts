/**
 * «Answer once, cleared everywhere» (v2.58.50, as src/lib/pairNotices.ts):
 * when an application gets an outcome — «No avanzar», a contract sent,
 * «Proponer un animal», or the adoption that closes it — the bell notices
 * about its form stop reading as unread, for the form-link owner and every
 * teammate who got a copy (both carry `metadata.submissionId`: the submit
 * route and its notifyOrgMembers fan-out). The notice used to be cleared by
 * opening /form-results; it now opens the panel, and the answer may come from
 * anywhere (the email twin, the home, Mis animales).
 *
 * Only `read` changes: a notice is never deleted, so the history stays.
 * Best-effort: a failure is logged and never undoes the answer.
 */
import { and, eq, sql } from 'drizzle-orm';
import { notifications } from '@/db/schema';
import type { NotificationType } from '@/domain/constants';
import { logger } from '@/lib/logger';

/** The notice a submitted form leaves in the bell (the owner's and each teammate's copy). */
export const FORM_NOTICE_TYPE = 'form_submission' satisfies NotificationType;

// CASE, not `json_valid(...) AND …`: SQLite doesn't promise to test json_valid first, and json_extract raises on invalid JSON.
const submissionOf = sql`CASE WHEN json_valid(${notifications.metadata}) THEN json_extract(${notifications.metadata}, '$.submissionId') END`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the D1/better-sqlite db union, as the callers pass it
export async function clearFormNotices(db: any, submissionId: string, ctx: Record<string, unknown> = {}): Promise<void> {
    if (!submissionId) return;
    try {
        await db.update(notifications)
            .set({ read: 1 })
            .where(and(
                eq(notifications.read, 0),
                eq(notifications.type, FORM_NOTICE_TYPE),
                sql`${submissionOf} = ${submissionId}`,
            ));
    } catch (e) {
        logger.warn('clearFormNotices: form notices left unread', {
            ...ctx, submissionId, error: e instanceof Error ? e.message : String(e),
        });
    }
}
