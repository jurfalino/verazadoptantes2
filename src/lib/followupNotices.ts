/**
 * «Answer once, cleared everywhere» for check-up reminders (Jon 2026-11-10):
 * once every check-up a `follow_up_due` notice lists has been registered —
 * from the homepage panel, the animal's page, by anyone on the team — the
 * notice stops reading as unread, for everyone who got it.
 *
 * A notice lists its check-ups in `metadata.items` (the daily bundle, one
 * notice per person per day — workers/followup-cron) or, for notices written
 * before the bundle, as one item at the top level of `metadata`.
 * A check-up is registered when an event carries its slot key: adopter_events
 * (check-ins, for that placement) or animal_events (health slots) — the same
 * rows the Worker reads to decide what's due.
 *
 * Only `read` changes; never deleted. Best-effort: logged, never fails the save.
 */
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { adopterEvents, animalEvents, notifications } from '@/db/schema';
import type { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export interface FollowupNoticeItem { animalId: string; placementId?: string | null; followupKey: string }

/** The check-ups a notice lists (bundle or single), or [] when unreadable. */
export function followupNoticeItems(metadata: string | null): FollowupNoticeItem[] {
    let m: unknown;
    try { m = JSON.parse(metadata ?? ''); } catch { return []; }
    if (!m || typeof m !== 'object') return [];
    const raw = Array.isArray((m as { items?: unknown }).items) ? (m as { items: unknown[] }).items : [m];
    return raw.flatMap(x => {
        const i = x as Partial<FollowupNoticeItem>;
        return typeof i?.animalId === 'string' && typeof i?.followupKey === 'string'
            ? [{ animalId: i.animalId, placementId: typeof i.placementId === 'string' ? i.placementId : null, followupKey: i.followupKey }]
            : [];
    });
}

async function isRegistered(db: Db, item: FollowupNoticeItem): Promise<boolean> {
    const [checkIn, care] = await Promise.all([
        db.select({ id: adopterEvents.id }).from(adopterEvents).where(and(
            eq(adopterEvents.animalId, item.animalId),
            eq(adopterEvents.followupKey, item.followupKey),
            item.placementId ? or(eq(adopterEvents.placementId, item.placementId), isNull(adopterEvents.placementId)) : undefined,
        )).limit(1),
        db.select({ id: animalEvents.id }).from(animalEvents).where(and(
            eq(animalEvents.animalId, item.animalId),
            eq(animalEvents.followupKey, item.followupKey),
        )).limit(1),
    ]);
    return checkIn.length > 0 || care.length > 0;
}

/** After a check-up of `animalId` was registered: mark read every reminder whose check-ups are all done now. */
export async function clearDoneFollowupNotices(db: Db, animalId: string, ctx: Record<string, unknown> = {}): Promise<void> {
    if (!animalId) return;
    try {
        // CASE guards: json_extract / json_each raise on invalid JSON, and SQLite doesn't promise to test json_valid first.
        const meta = sql`CASE WHEN json_valid(${notifications.metadata}) THEN ${notifications.metadata} END`;
        const mentions = sql`(json_extract(${meta}, '$.animalId') = ${animalId}
            OR EXISTS (SELECT 1 FROM json_each(json_extract(${meta}, '$.items')) j
                       WHERE json_extract(j.value, '$.animalId') = ${animalId}))`;
        const open = await db.select({ id: notifications.id, metadata: notifications.metadata })
            .from(notifications)
            .where(and(eq(notifications.type, 'follow_up_due'), eq(notifications.read, 0), mentions));
        const done = new Map<string, boolean>(); // one lookup per check-up, shared by every teammate's notice
        for (const n of open) {
            const items = followupNoticeItems(n.metadata);
            if (items.length === 0) continue;
            let all = true;
            for (const item of items) {
                const key = `${item.animalId}|${item.placementId ?? ''}|${item.followupKey}`;
                if (!done.has(key)) done.set(key, await isRegistered(db, item));
                if (!done.get(key)) { all = false; break; }
            }
            if (all) await db.update(notifications).set({ read: 1 }).where(eq(notifications.id, n.id));
        }
    } catch (e) {
        logger.warn('clearDoneFollowupNotices: reminders left unread', {
            ...ctx, animalId, error: e instanceof Error ? e.message : String(e),
        });
    }
}
