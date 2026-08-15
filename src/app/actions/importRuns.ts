'use server';

/**
 * Spreadsheet-import audit trail (admin view at /admin/imports). The run header
 * is written when the import STARTS (so an abandoned run is still visible as
 * 'running'), and the per-row items are written when it finishes. The actor is
 * resolved server-side — never trusted from the client. Read paths are
 * admin-gated.
 */

import { desc, eq, or, sql, getTableColumns } from 'drizzle-orm';
import { getDb, getUser, getIsAdmin } from './_db';
import { importRuns, importRunItems } from '@/db/schema';
import { isRealActorEmail } from '@/lib/piiAccess';
import { getOrgMatesOf } from '@/lib/orgMembership';
import { logger } from '@/lib/logger';

/** Live counts + last-activity derived from the items, so the admin/user view is
 *  accurate even when the client's finishImportRun never ran (the stored counters
 *  stay 0 in that case). Correlated subqueries — one row per run. */
const derivedRunCols = () => ({
    itemCount: sql<number>`(SELECT COUNT(*) FROM import_run_items WHERE run_id = ${importRuns.id})`,
    dCreated: sql<number>`(SELECT COUNT(*) FROM import_run_items WHERE run_id = ${importRuns.id} AND status = 'created')`,
    dUpdated: sql<number>`(SELECT COUNT(*) FROM import_run_items WHERE run_id = ${importRuns.id} AND status = 'updated')`,
    dSkipped: sql<number>`(SELECT COUNT(*) FROM import_run_items WHERE run_id = ${importRuns.id} AND status = 'skipped')`,
    dFailed: sql<number>`(SELECT COUNT(*) FROM import_run_items WHERE run_id = ${importRuns.id} AND status = 'failed')`,
    lastItemAt: sql<number | null>`(SELECT MAX(created_at) FROM import_run_items WHERE run_id = ${importRuns.id})`,
});

export type EnrichedImportRun = typeof importRuns.$inferSelect & {
    itemCount: number; dCreated: number; dUpdated: number; dSkipped: number; dFailed: number; lastItemAt: number | null;
};

export interface ImportRunItemInput {
    rowIndex?: number | null;
    adopterId?: string | null;
    adopterName?: string | null;
    action?: 'create' | 'upsert' | 'skip' | null;
    status?: 'created' | 'updated' | 'skipped' | 'failed' | null;
    matchedAdopterId?: string | null;
    matchedAdopterName?: string | null;
    matchConfidence?: number | null;
    message?: string | null;
}

/** Record the run header the moment an import begins. Idempotent-ish: a repeated
 *  call for the same runId is ignored (the header already exists). */
export async function startImportRun(input: { runId: string; source?: string | null; total?: number }): Promise<{ ok: boolean }> {
    let actor = '';
    try { actor = await getUser(); } catch { /* anonymous */ }
    if (!isRealActorEmail(actor)) return { ok: false };
    try {
        const db = await getDb();
        if (!db) return { ok: false };
        const existing = await db.select({ id: importRuns.id }).from(importRuns).where(eq(importRuns.id, input.runId)).get();
        if (existing) return { ok: true };
        await db.insert(importRuns).values({
            id: input.runId, actorEmail: actor, source: input.source ?? null,
            total: input.total ?? 0, status: 'running', startedAt: new Date(),
        });
        return { ok: true };
    } catch (e) {
        logger.warn('startImportRun failed', { runId: input.runId, error: e instanceof Error ? e.message : String(e) });
        return { ok: false };
    }
}

/** Mark the run completed with final counts (items are written per-batch by
 *  importAdoptersBatch). Only the run's own actor (or an admin) may finish it. */
export async function finishImportRun(input: {
    runId: string;
    items?: ImportRunItemInput[]; // accepted for back-compat; no longer used here
    counts?: { created: number; updated: number; skipped: number; failed: number };
}): Promise<{ ok: boolean }> {
    let actor = '';
    try { actor = await getUser(); } catch { /* anonymous */ }
    if (!isRealActorEmail(actor)) return { ok: false };
    try {
        const db = await getDb();
        if (!db) return { ok: false };
        const run = await db.select({ actorEmail: importRuns.actorEmail }).from(importRuns).where(eq(importRuns.id, input.runId)).get();
        if (!run) return { ok: false };
        if (run.actorEmail !== actor && !(await getIsAdmin())) return { ok: false };

        // Items are written incrementally by importAdoptersBatch (per batch), so
        // finishImportRun only closes the run — no big all-at-once item write that
        // could blow the Worker limit and lose the whole audit.
        const c = input.counts ?? { created: 0, updated: 0, skipped: 0, failed: 0 };
        await db.update(importRuns).set({
            status: 'completed', finishedAt: new Date(),
            createdCount: c.created, updatedCount: c.updated, skippedCount: c.skipped, failedCount: c.failed,
        }).where(eq(importRuns.id, input.runId));
        return { ok: true };
    } catch (e) {
        const errorId = logger.error('finishImportRun failed', e, { runId: input.runId, actorEmail: actor });
        logger.warn('finishImportRun error surfaced', { runId: input.runId, errorId });
        return { ok: false };
    }
}

/** Admin: list ALL import runs, newest first (counts derived from items). */
export async function getImportRuns(): Promise<EnrichedImportRun[]> {
    if (!(await getIsAdmin())) return [];
    try {
        const db = await getDb();
        if (!db) return [];
        return await db.select({ ...getTableColumns(importRuns), ...derivedRunCols() })
            .from(importRuns).orderBy(desc(importRuns.startedAt)).limit(200) as EnrichedImportRun[];
    } catch (e) {
        logger.warn('getImportRuns failed', { error: e instanceof Error ? e.message : String(e) });
        return [];
    }
}

/** Any authenticated user: their OWN import runs plus their org-mates' — so a
 *  rescuer can see (and their group can see) previous imports from /import/sheet. */
export async function getMyImportRuns(): Promise<EnrichedImportRun[]> {
    let actor = '';
    try { actor = await getUser(); } catch { /* anonymous */ }
    if (!isRealActorEmail(actor)) return [];
    try {
        const db = await getDb();
        if (!db) return [];
        const mates = await getOrgMatesOf(actor).catch(() => [] as Array<{ email: string }>);
        const emails = Array.from(new Set([actor, ...mates.map(m => m.email)]));
        const cond = or(...emails.map(e => eq(importRuns.actorEmail, e)));
        return await db.select({ ...getTableColumns(importRuns), ...derivedRunCols() })
            .from(importRuns).where(cond).orderBy(desc(importRuns.startedAt)).limit(50) as EnrichedImportRun[];
    } catch (e) {
        logger.warn('getMyImportRuns failed', { error: e instanceof Error ? e.message : String(e) });
        return [];
    }
}

/** Admin: the per-row items for one run, in source order. */
export async function getImportRunItems(runId: string): Promise<Array<typeof importRunItems.$inferSelect>> {
    if (!(await getIsAdmin())) return [];
    try {
        const db = await getDb();
        if (!db) return [];
        return await db.select().from(importRunItems).where(eq(importRunItems.runId, runId)).orderBy(importRunItems.rowIndex);
    } catch (e) {
        logger.warn('getImportRunItems failed', { runId, error: e instanceof Error ? e.message : String(e) });
        return [];
    }
}
