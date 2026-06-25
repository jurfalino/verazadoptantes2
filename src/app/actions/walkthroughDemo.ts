'use server';

/**
 * Guided-walkthrough demo data — server access.
 *
 * The 3 demo records are real `adopters` rows that are SOFT-DELETED + `isDemo=1`,
 * so every real search/duplicate/analytics query (each filters `deleted_at IS
 * NULL`) excludes them automatically. Here we fetch them BY the `isDemo` marker
 * (ignoring deletedAt) for the walkthrough, and seed/reset them from the code
 * fixtures. If the rows aren't seeded yet, the walkthrough falls back to the
 * fixtures so it always renders.
 */

import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { adopters } from '@/db/schema';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import type { DiscoveryMatch } from './types';
import { getDb, checkIsAdminAsync } from './_db';
import {
    WALKTHROUGH_DEMO_FIXTURES,
    buildDemoMatch,
    demoAdopterRow,
} from '@/lib/walkthroughDemo';

/**
 * The 3 demo cards as `DiscoveryMatch[]`, in fixture order. Reads the real
 * soft-deleted `isDemo` rows when present (so an admin's PII edits show), else
 * falls back to the code fixtures. Masking is applied in `buildDemoMatch`.
 */
export async function getWalkthroughDemoMatches(): Promise<DiscoveryMatch[]> {
    try {
        const db = await getDb();
        if (db) {
            const rows = (await db.select().from(adopters).where(eq(adopters.isDemo, 1))) as (typeof adopters.$inferSelect)[];
            if (rows.length > 0) {
                const byId = new Map(rows.map(r => [r.id, r]));
                return WALKTHROUGH_DEMO_FIXTURES.map(f => {
                    const row = byId.get(f.id);
                    return row
                        ? buildDemoMatch(row, f.overlay, row.isPublic !== 1)
                        : buildDemoMatch(demoAdopterRow(f), f.overlay, f.gated);
                });
            }
        }
    } catch (e) {
        logger.warn('getWalkthroughDemoMatches: DB read failed, using fixtures', {
            error: e instanceof Error ? e.message : String(e),
        });
    }
    // Not seeded (or no DB) — render from the code fixtures.
    return WALKTHROUGH_DEMO_FIXTURES.map(f => buildDemoMatch(demoAdopterRow(f), f.overlay, f.gated));
}

/**
 * Seed / reset the 3 demo rows from the code fixtures (admin only). Idempotent —
 * upserts by id, so running it again resets any admin edits to the defaults.
 */
export async function seedWalkthroughDemo(): Promise<{ ok: boolean; count?: number; error?: string }> {
    const actorEmail = (await auth())?.user?.email ?? null;
    try {
        if (!actorEmail || !(await checkIsAdminAsync(actorEmail))) {
            return { ok: false, error: 'Unauthorized' };
        }
        const db = await getDb();
        if (!db) return { ok: false, error: 'Database unavailable' };

        for (const f of WALKTHROUGH_DEMO_FIXTURES) {
            const row = demoAdopterRow(f);
            const { id: _id, ...mutable } = row;
            await db
                .insert(adopters)
                .values(row)
                .onConflictDoUpdate({ target: adopters.id, set: mutable });
        }

        logAudit({
            userEmail: actorEmail,
            action: 'walkthrough_demo_seed',
            details: { count: WALKTHROUGH_DEMO_FIXTURES.length },
        });
        return { ok: true, count: WALKTHROUGH_DEMO_FIXTURES.length };
    } catch (e) {
        const errorId = logger.error('seedWalkthroughDemo failed', e, { actorEmail });
        return { ok: false, error: `No se pudo cargar la demo (${errorId})` };
    }
}
