/**
 * Marks timeline observations that anchor a completed interview (spec §5.3).
 * One lookup per observation row (D1: no IN lists). A failed lookup degrades
 * to "no badge" and is logged.
 */
import { and, eq } from 'drizzle-orm';
import { interviews } from '@/db/schema';
import { canViewInterviewAnswers } from '@/domain/interview/access';
import { logger } from '@/lib/logger';
import { safeError } from '@/lib/interviews/safeError';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- same Db handle type the other action helpers take
type Db = any;

export async function attachInterviewLinks<T extends { id: string; recordType?: string | null }>(
    db: Db,
    rows: T[],
    ctx: { viewer: string; ownerEmail: string | null; viewerIsAdmin: boolean; viewerIsOrgMate: boolean },
): Promise<Array<T & { interview?: { id: string; canViewAnswers: boolean } }>> {
    return Promise.all(rows.map(async (row) => {
        if (row.recordType !== 'observation') return row;
        let hit: { id: string; conductedBy: string } | undefined;
        try {
            hit = await db.select({ id: interviews.id, conductedBy: interviews.conductedBy })
                .from(interviews)
                .where(and(eq(interviews.eventId, row.id), eq(interviews.status, 'completed')))
                .get();
        } catch (e) {
            logger.warn('attachInterviewLinks: D1 fallback hit', { eventId: row.id, error: safeError(e).message });
        }
        if (!hit) return row;
        return {
            ...row,
            interview: {
                id: hit.id,
                canViewAnswers: canViewInterviewAnswers({ viewer: ctx.viewer, conductedBy: hit.conductedBy, ownerEmail: ctx.ownerEmail, viewerIsAdmin: ctx.viewerIsAdmin, viewerIsOrgMate: ctx.viewerIsOrgMate }),
            },
        };
    }));
}
