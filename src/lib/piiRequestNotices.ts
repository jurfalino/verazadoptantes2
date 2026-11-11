/**
 * «Answer once, cleared everywhere» (as src/lib/pairNotices.ts and
 * src/lib/formNotices.ts) for contact-access requests: when any approver —
 * the owner, an editor or an admin — approves or denies a request, the
 * `pii_access_request` notices about it stop reading as unread for every
 * approver who got one. The writer (src/lib/piiAccessRequest.ts) has stored
 * `metadata.requestId` on every copy since the type was introduced (v2.15.0),
 * so the request id alone identifies them. The requester's answer
 * (`pii_access_approved` / `pii_access_denied`) carries the same id, so the
 * type is matched too.
 *
 * Only `read` changes: a notice is never deleted, so the history stays.
 * Best-effort: a failure is logged and never undoes the answer.
 */
import { and, eq, sql } from 'drizzle-orm';
import { notifications } from '@/db/schema';
import type { NotificationType } from '@/domain/constants';
import { logger } from '@/lib/logger';

/** The notice an access request leaves in each approver's bell. */
export const PII_REQUEST_NOTICE_TYPE = 'pii_access_request' satisfies NotificationType;

// CASE, not `json_valid(...) AND …`: SQLite doesn't promise to test json_valid first, and json_extract raises on invalid JSON.
const requestOf = sql`CASE WHEN json_valid(${notifications.metadata}) THEN json_extract(${notifications.metadata}, '$.requestId') END`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the D1/better-sqlite db union, as the callers pass it
export async function clearPiiRequestNotices(db: any, requestId: string, ctx: Record<string, unknown> = {}): Promise<void> {
    if (!requestId) return;
    try {
        await db.update(notifications)
            .set({ read: 1 })
            .where(and(
                eq(notifications.read, 0),
                eq(notifications.type, PII_REQUEST_NOTICE_TYPE),
                sql`${requestOf} = ${requestId}`,
            ));
    } catch (e) {
        logger.warn('clearPiiRequestNotices: access-request notices left unread', {
            ...ctx, requestId, error: e instanceof Error ? e.message : String(e),
        });
    }
}
