'use server';

/**
 * Guided-walkthrough demo data — server access.
 *
 * The 3 demo records are real `adopters` rows that are SOFT-DELETED + `isDemo=1`,
 * so every real search/duplicate/analytics query (each filters `deleted_at IS
 * NULL`) excludes them automatically. We fetch them BY the `isDemo` marker
 * (ignoring deletedAt) for the walkthrough, and the admin panel seeds + edits
 * them. The display values (rating/flags/stats) live in a `WALKTHROUGH_DEMO_
 * OVERLAY` appConfig JSON override (keyed by id); the maskable PII lives on the
 * row. If neither is set, code fixtures are the fallback so the demo always
 * renders.
 */

import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { adopters, appConfig } from '@/db/schema';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import type { DiscoveryMatch } from './types';
import { getDb, checkIsAdminAsync } from './_db';
import {
    WALKTHROUGH_DEMO_FIXTURES,
    buildDemoMatch,
    buildDemoMatchPhoneRevealed,
    demoAdopterRow,
    fixtureToEdit,
    applyRowToEdit,
    applyOverlayToEdit,
    editToOverlay,
    editToAdopterRow,
    type DemoOverlay,
    type DemoRecordEdit,
} from '@/lib/walkthroughDemo';

type AdopterRow = typeof adopters.$inferSelect;
type AnyDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

const OVERLAY_KEY = 'WALKTHROUGH_DEMO_OVERLAY';
/** The record the tour reveals in its "search name + phone" demonstration. */
const REVEAL_DEMO_ID = 'demo-juan-bueno';

/** Parse the admin overlay overrides ({ [id]: DemoOverlay }). Never throws. */
async function readOverlayOverrides(db: AnyDb): Promise<Record<string, DemoOverlay>> {
    try {
        const row = await db.select().from(appConfig).where(eq(appConfig.key, OVERLAY_KEY)).get();
        if (row?.value) return JSON.parse(row.value) as Record<string, DemoOverlay>;
    } catch (e) {
        logger.warn('readOverlayOverrides: parse failed', { error: e instanceof Error ? e.message : String(e) });
    }
    return {};
}

async function readDemoRows(db: AnyDb): Promise<Map<string, AdopterRow>> {
    const rows = (await db.select().from(adopters).where(eq(adopters.isDemo, 1))) as AdopterRow[];
    return new Map(rows.map(r => [r.id, r]));
}

/**
 * The 3 demo cards as `DiscoveryMatch[]`, in fixture order. PII from the real
 * `isDemo` rows when present (else fixtures); overlay from the appConfig
 * override when present (else fixtures). Masking is applied in `buildDemoMatch`.
 */
export async function getWalkthroughDemoMatches(revealIds: string[] = []): Promise<DiscoveryMatch[]> {
    // For a record in `revealIds`, render it as a "name + phone" search-match
    // would: ONLY the phone unlocked, email/address still masked (the accurate
    // partial reveal). Other records render normally (gated unless public).
    const build = (row: AdopterRow, overlay: DemoOverlay) =>
        revealIds.includes(row.id)
            ? buildDemoMatchPhoneRevealed(row, overlay)
            : buildDemoMatch(row, overlay, row.isPublic !== 1);
    try {
        const db = await getDb();
        if (db) {
            const [overrides, byId] = await Promise.all([readOverlayOverrides(db), readDemoRows(db)]);
            return WALKTHROUGH_DEMO_FIXTURES.map(f => {
                const row = byId.get(f.id) ?? demoAdopterRow(f);
                return build(row, overrides[f.id] ?? f.overlay);
            });
        }
    } catch (e) {
        logger.warn('getWalkthroughDemoMatches: DB read failed, using fixtures', {
            error: e instanceof Error ? e.message : String(e),
        });
    }
    return WALKTHROUGH_DEMO_FIXTURES.map(f => build(demoAdopterRow(f), f.overlay));
}

/** Same as getWalkthroughDemoMatches but with the reveal record UNMASKED — the
 * tour's "search name + phone → contact revealed" step. Param-less so the reveal
 * set is built entirely server-side (no array arg across the client boundary). */
export async function getWalkthroughDemoRevealed(): Promise<DiscoveryMatch[]> {
    return getWalkthroughDemoMatches([REVEAL_DEMO_ID]);
}

/** The 3 records flattened into the admin-editable shape (admin only). */
export async function getWalkthroughDemoAdmin(): Promise<{ ok: boolean; records?: DemoRecordEdit[]; error?: string }> {
    const actorEmail = (await auth())?.user?.email ?? null;
    try {
        if (!actorEmail || !(await checkIsAdminAsync(actorEmail))) return { ok: false, error: 'Unauthorized' };
        const db = await getDb();
        if (!db) return { ok: false, error: 'Database unavailable' };
        const [overrides, byId] = await Promise.all([readOverlayOverrides(db), readDemoRows(db)]);
        const records = WALKTHROUGH_DEMO_FIXTURES.map(f => {
            let edit = fixtureToEdit(f);
            const row = byId.get(f.id);
            if (row) edit = applyRowToEdit(edit, row);
            const o = overrides[f.id];
            if (o) edit = applyOverlayToEdit(edit, o);
            return edit;
        });
        return { ok: true, records };
    } catch (e) {
        const errorId = logger.error('getWalkthroughDemoAdmin failed', e, { actorEmail });
        return { ok: false, error: `No se pudo cargar la demo (${errorId})` };
    }
}

async function writeOverlay(db: AnyDb, actorEmail: string, id: string, overlay: DemoOverlay) {
    const overrides = await readOverlayOverrides(db);
    overrides[id] = overlay;
    const value = JSON.stringify(overrides);
    await db.insert(appConfig)
        .values({ key: OVERLAY_KEY, value, updatedAt: new Date(), updatedBy: actorEmail })
        .onConflictDoUpdate({ target: appConfig.key, set: { value, updatedAt: new Date(), updatedBy: actorEmail } });
}

async function upsertRow(db: AnyDb, row: AdopterRow) {
    const { id: _id, ...mutable } = row;
    await db.insert(adopters).values(row).onConflictDoUpdate({ target: adopters.id, set: mutable });
}

/** Save one demo record's PII (→ row) + display values (→ overlay). Admin only. */
export async function saveWalkthroughDemoRecord(edit: DemoRecordEdit): Promise<{ ok: boolean; error?: string }> {
    const actorEmail = (await auth())?.user?.email ?? null;
    try {
        if (!actorEmail || !(await checkIsAdminAsync(actorEmail))) return { ok: false, error: 'Unauthorized' };
        if (!WALKTHROUGH_DEMO_FIXTURES.some(f => f.id === edit.id)) return { ok: false, error: 'Unknown demo record' };
        const db = await getDb();
        if (!db) return { ok: false, error: 'Database unavailable' };

        await upsertRow(db, editToAdopterRow(edit));
        await writeOverlay(db, actorEmail, edit.id, editToOverlay(edit));

        logAudit({ userEmail: actorEmail, action: 'walkthrough_demo_save', details: { id: edit.id } });
        return { ok: true };
    } catch (e) {
        const errorId = logger.error('saveWalkthroughDemoRecord failed', e, { actorEmail, id: edit.id });
        return { ok: false, error: `No se pudo guardar (${errorId})` };
    }
}

/**
 * Seed / reset the 3 demo rows to the code fixtures AND clear the overlay
 * override (admin only). Idempotent — running it again resets any edits.
 */
export async function seedWalkthroughDemo(): Promise<{ ok: boolean; count?: number; error?: string }> {
    const actorEmail = (await auth())?.user?.email ?? null;
    try {
        if (!actorEmail || !(await checkIsAdminAsync(actorEmail))) return { ok: false, error: 'Unauthorized' };
        const db = await getDb();
        if (!db) return { ok: false, error: 'Database unavailable' };

        for (const f of WALKTHROUGH_DEMO_FIXTURES) {
            await upsertRow(db, demoAdopterRow(f));
        }
        // Clear overrides so the fixture overlays apply again.
        await db.insert(appConfig)
            .values({ key: OVERLAY_KEY, value: '{}', updatedAt: new Date(), updatedBy: actorEmail })
            .onConflictDoUpdate({ target: appConfig.key, set: { value: '{}', updatedAt: new Date(), updatedBy: actorEmail } });

        logAudit({ userEmail: actorEmail, action: 'walkthrough_demo_seed', details: { count: WALKTHROUGH_DEMO_FIXTURES.length } });
        return { ok: true, count: WALKTHROUGH_DEMO_FIXTURES.length };
    } catch (e) {
        const errorId = logger.error('seedWalkthroughDemo failed', e, { actorEmail });
        return { ok: false, error: `No se pudo cargar la demo (${errorId})` };
    }
}
