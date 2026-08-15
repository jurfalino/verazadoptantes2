'use server';

/**
 * Spreadsheet-import audit trail (admin view at /admin/imports). The run header
 * is written when the import STARTS (so an abandoned run is still visible as
 * 'running'), and the per-row items are written when it finishes. The actor is
 * resolved server-side — never trusted from the client. Read paths are
 * admin-gated.
 */

import { desc, eq } from 'drizzle-orm';
import { getDb, getUser, getIsAdmin } from './_db';
import { importRuns, importRunItems } from '@/db/schema';
import { isRealActorEmail } from '@/lib/piiAccess';
import { logger } from '@/lib/logger';

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

/** Write the run's per-row items and mark the run completed with final counts.
 *  Only the run's own actor (or an admin) may finish it. */
export async function finishImportRun(input: {
    runId: string;
    items: ImportRunItemInput[];
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

        // Chunked insert — a single multi-row INSERT of hundreds of rows blows past
        // SQLite/D1's bound-parameter limit. ~40 rows × ~12 cols stays well under.
        const rows = input.items.map(it => ({
            id: crypto.randomUUID(), runId: input.runId,
            rowIndex: it.rowIndex ?? null, adopterId: it.adopterId ?? null, adopterName: it.adopterName ?? null,
            action: it.action ?? null, status: it.status ?? null,
            matchedAdopterId: it.matchedAdopterId ?? null, matchedAdopterName: it.matchedAdopterName ?? null,
            matchConfidence: it.matchConfidence ?? null, message: it.message ?? null, createdAt: new Date(),
        }));
        for (let i = 0; i < rows.length; i += 40) {
            await db.insert(importRunItems).values(rows.slice(i, i + 40));
        }

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

/** Admin: list import runs, newest first. */
export async function getImportRuns(): Promise<Array<typeof importRuns.$inferSelect>> {
    if (!(await getIsAdmin())) return [];
    try {
        const db = await getDb();
        if (!db) return [];
        return await db.select().from(importRuns).orderBy(desc(importRuns.startedAt)).limit(200);
    } catch (e) {
        logger.warn('getImportRuns failed', { error: e instanceof Error ? e.message : String(e) });
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
