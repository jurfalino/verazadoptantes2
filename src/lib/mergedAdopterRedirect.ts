/**
 * Resolve a merged-away adopter id to the live profile that absorbed it, so
 * /adopter/<id> can redirect instead of 404ing. A plain server module, NOT
 * 'use server' — it must never become a browser-callable endpoint. The rules
 * are in src/domain/mergeRedirect.ts; this file only answers, per id, "live,
 * merged into X, or gone?".
 *
 * The merge target is read from the merge's audit_log row (action
 * 'adopter_merge', details.secondaryId → details.primaryId) — the same row
 * unmergeAdopters uses, so the redirect and undo can never disagree. A merged
 * profile is marked tokenHash = 'MERGED' (src/lib/adopterMerge.ts); any other
 * deletion ('DELETED', API deletes, demo rows) is not followed.
 */

import { adopters, auditLog } from '@/db/schema';
import { and, eq, sql, desc } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { followMergeChain, pickActiveMerge, type MergeStep, type MergeRecord } from '@/domain/mergeRedirect';

async function stepFor(id: string): Promise<MergeStep> {
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    const row = await db.select({ deletedAt: adopters.deletedAt, tokenHash: adopters.tokenHash })
        .from(adopters).where(eq(adopters.id, id)).get() as { deletedAt: Date | null; tokenHash: string | null } | undefined;
    if (!row) return { kind: 'gone' };
    if (!row.deletedAt) return { kind: 'live' };
    if (row.tokenHash !== 'MERGED') return { kind: 'gone' };

    // json_valid guard: one malformed details row must not error the query
    // (that would turn every merged link back into a 404).
    const rows = await db.select({ target: auditLog.target, details: auditLog.details, createdAt: auditLog.createdAt })
        .from(auditLog)
        .where(and(
            eq(auditLog.action, 'adopter_merge'),
            sql`CASE WHEN json_valid(${auditLog.details}) THEN json_extract(${auditLog.details}, '$.secondaryId') END = ${id}`,
        ))
        .orderBy(desc(auditLog.createdAt))
        .limit(10)
        .all() as Array<{ target: string | null; details: string | null; createdAt: Date | null }>;

    const records: MergeRecord[] = rows.map(r => {
        let d: { primaryId?: string; undoneAt?: number } = {};
        try { d = JSON.parse(r.details || '{}'); } catch (e) {
            logger.warn('resolveMergedAdopterId: unparseable merge audit row', { adopterId: id, error: e instanceof Error ? e.message : String(e) });
        }
        return {
            primaryId: d.primaryId ?? r.target,
            createdAt: r.createdAt ? r.createdAt.getTime() : 0,
            undone: !!d.undoneAt,
        };
    });
    const into = pickActiveMerge(records);
    return into ? { kind: 'merged', into } : { kind: 'gone' };
}

/** The live survivor's id, or null when `id` should stay a 404. Throws on DB failure. */
export function resolveMergedAdopterId(id: string): Promise<string | null> {
    return followMergeChain(id, stepFor);
}
