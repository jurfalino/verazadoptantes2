/**
 * «Cambios en tus perfiles»: someone added a record (with its rating), photos
 * or videos, or a delivery address to a profile — the owner's team hears it as
 * ONE notice per action (`profile_content_added`, Jon 2026-11-08). NOT a 'use
 * server' module: every function takes the actor as an argument.
 *
 * - Recipients: the profile's owner + the owner's org-mates, through the one
 *   rule (keepChangeRecipients): never the actor; a teammate of the actor only
 *   if they chose «Otros rescatistas y mi equipo».
 * - One action reaches the server as several calls (the record, then each
 *   photo, often in parallel), so each call MERGES its part into the
 *   recipient's notice from the same person about the same profile within
 *   PROFILE_ADDITION_NOTICE_WINDOW_MS (compare-and-swap on the row's metadata,
 *   so parallel photos are all counted). With none yet, it is created under an
 *   id fixed by (recipient, profile, person, time slot) — two parallel first
 *   calls create one row, and the loser merges into it. Merging marks it unread
 *   again; the email went out with the first part (as renames do — S5).
 * - Never the address itself or any contact value: the body names the profile
 *   and the actor's display name only. The metadata carries a hashed actor key.
 * - Runs after the response (`runAfterResponse`: Workers kill fire-and-forget)
 *   and never throws — the save already landed. Every failure is logged.
 *
 * Not told (no call): bulk imports, the third-party API, forms and contracts
 * (their own notices), a brand-new profile (no owner to tell yet).
 */
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { adopterEvents, adopters, notifications, placements } from '@/db/schema';
import type { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { runAfterResponse } from '@/lib/background';
import { isRealActorEmail } from '@/lib/piiAccess';
import { getProfileChangesFromForEmail, keepChangeRecipients } from '@/lib/teamChangeAudience';
import { getOrgMemberEmailsFor, isOrgMate } from '@/lib/orgMembership';
import { realOwner } from '@/domain/dedupPair';
import {
    additionFromParams, additionParams, isEmptyAddition, mergeAdditions,
    PROFILE_ADDITION_NOTICE_WINDOW_MS, type ProfileAddition,
} from '@/domain/profileAdditions';
import { notificationContent, type NotificationTemplate } from '@/domain/notificationTemplates';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Ctx = Record<string, unknown>;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const TYPE = 'profile_content_added' as const;
const MERGE_ATTEMPTS = 4;

export interface ProfileAdditionNotice {
    adopterId: string;
    /** Resolved by the caller before the response. */
    actor: string;
    add: ProfileAddition;
    /** Which write path (for the logs). */
    op: string;
    /**
     * The record a photo was attached to (adopter_images.adoption_id). Told only
     * when that record is on this profile — an animal event's photo is stored
     * under the animal's holder but is not something added to their profile.
     */
    recordId?: string | null;
}

async function sha(text: string, bytes: number): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].slice(0, bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

const norm = (e: string) => e.trim().toLowerCase();

export async function notifyProfileAddition(db: Db, n: ProfileAdditionNotice): Promise<void> {
    const ctx: Ctx = { op: n.op, adopterId: n.adopterId, actor: n.actor };
    if (isEmptyAddition(n.add)) return;
    if (!isRealActorEmail(n.actor)) {
        logger.info('profileAdditionNotices: no real actor — no notice', ctx);
        return;
    }
    await runAfterResponse('profileAdditionNotice', async () => {
        try {
            await deliverAll(db, n, ctx);
        } catch (e) {
            logger.warn('profileAdditionNotices: notice not sent (the save stands)', { ...ctx, error: errMsg(e) });
        }
    }, ctx);
}

async function deliverAll(db: Db, n: ProfileAdditionNotice, ctx: Ctx): Promise<void> {
    const row = await db.select({ name: adopters.name, addedBy: adopters.addedBy, deletedAt: adopters.deletedAt })
        .from(adopters).where(eq(adopters.id, n.adopterId)).get() as { name: string | null; addedBy: string | null; deletedAt: unknown } | undefined;
    // Animal photos are keyed on an email or «__available__», not a profile: nobody to tell.
    if (!row || row.deletedAt) {
        logger.info('profileAdditionNotices: no live profile — no notice', ctx);
        return;
    }
    if (n.recordId && !(await recordIsOnProfile(db, n.recordId, n.adopterId))) {
        logger.info('profileAdditionNotices: the photo\'s record is not on this profile — no notice', { ...ctx, recordId: n.recordId });
        return;
    }
    const owner = realOwner(row.addedBy);
    if (!owner) {
        logger.info('profileAdditionNotices: the profile has no owner — no notice', ctx);
        return;
    }
    const team = await getOrgMemberEmailsFor(owner).catch((e: unknown) => {
        logger.warn('profileAdditionNotices: team lookup failed, only the owner told', { ...ctx, error: errMsg(e) });
        return [] as string[];
    });
    const recipients = await keepChangeRecipients([owner, ...team], n.actor, ctx, {
        isTeammate: (recipient, actor) => isOrgMate(recipient, actor),
        fromOf: (recipient) => getProfileChangesFromForEmail(db, recipient),
    });
    if (!recipients.length) {
        logger.info('profileAdditionNotices: nobody to tell', ctx);
        return;
    }
    const { resolveDisplayName } = await import('@/app/actions/notifications');
    const [actorName, actorKey] = await Promise.all([resolveDisplayName(n.actor), sha(`profile-addition:${norm(n.actor)}`, 8)]);
    const adopterName = row.name?.trim() || undefined;
    await Promise.all(recipients.map(async (userId) => {
        try {
            await deliver(db, { userId, adopterId: n.adopterId, adopterName, actorName, actorKey, add: n.add }, ctx);
        } catch (e) {
            logger.warn('profileAdditionNotices: notice not sent to one recipient', { ...ctx, error: errMsg(e) });
        }
    }));
    logger.info('profileAdditionNotices: sent', { ...ctx, recipients: recipients.length });
}

/** Is `recordId` one of this profile's records (an event of it, or an animal placed with it)? */
async function recordIsOnProfile(db: Db, recordId: string, adopterId: string): Promise<boolean> {
    const [event, placement] = await Promise.all([
        db.select({ id: adopterEvents.id }).from(adopterEvents).where(and(eq(adopterEvents.id, recordId), eq(adopterEvents.adopterId, adopterId))).get(),
        db.select({ id: placements.id }).from(placements).where(and(eq(placements.animalId, recordId), eq(placements.adopterId, adopterId))).limit(1).get(),
    ]);
    return !!event || !!placement;
}

interface Delivery {
    userId: string; adopterId: string; adopterName: string | undefined; actorName: string; actorKey: string; add: ProfileAddition;
}

const templateFor = (d: Delivery, add: ProfileAddition): NotificationTemplate => ({
    key: TYPE,
    params: { actorName: d.actorName, ...(d.adopterName ? { adopterName: d.adopterName } : {}), ...additionParams(add) },
});

async function deliver(db: Db, d: Delivery, ctx: Ctx): Promise<void> {
    const since = new Date(Date.now() - PROFILE_ADDITION_NOTICE_WINDOW_MS);
    const recent = await db.select({ id: notifications.id }).from(notifications).where(and(
        eq(notifications.userId, d.userId),
        eq(notifications.type, TYPE),
        gte(notifications.createdAt, since),
        sql`json_extract(${notifications.metadata}, '$.profileId') = ${d.adopterId}`,
        sql`json_extract(${notifications.metadata}, '$.actorKey') = ${d.actorKey}`,
    )).orderBy(desc(notifications.createdAt)).limit(1).get() as { id: string } | undefined;
    if (recent && await mergeInto(db, recent.id, d, ctx)) return;

    // None yet: create it under an id fixed for this time slot, so parallel first calls make one row.
    const slot = Math.floor(Date.now() / PROFILE_ADDITION_NOTICE_WINDOW_MS);
    const id = `pca-${await sha(`profile-addition:${norm(d.userId)}|${d.adopterId}|${d.actorKey}|${slot}`, 16)}`;
    const { createNotification } = await import('@/app/actions/notifications');
    const created = await createNotification({
        id, ifAbsent: true, userId: d.userId, type: 'profile_content_added',
        ...notificationContent(templateFor(d, d.add)),
        url: `/adopter/${d.adopterId}`, icon: '➕',
        metadata: { adopterId: d.adopterId, profileId: d.adopterId, actorKey: d.actorKey },
    });
    if (created) return;
    // Another call created it first (or this type is switched off: then there is no row and nothing to do).
    if (!(await mergeInto(db, id, d, ctx))) logger.info('profileAdditionNotices: no notice row to merge into (switched off?)', { ...ctx, notificationId: id });
}

/** Merge `d.add` into the notice `id` (compare-and-swap on its metadata). False when the row is gone or the merge kept losing. */
async function mergeInto(db: Db, id: string, d: Delivery, ctx: Ctx): Promise<boolean> {
    for (let attempt = 0; attempt < MERGE_ATTEMPTS; attempt++) {
        const row = await db.select({ metadata: notifications.metadata }).from(notifications).where(eq(notifications.id, id)).get() as { metadata: string | null } | undefined;
        if (!row) return false;
        let meta: Record<string, unknown> = {};
        try { meta = row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : {}; } catch (e) {
            logger.warn('profileAdditionNotices: notice metadata unreadable, starting it over', { ...ctx, notificationId: id, error: errMsg(e) });
        }
        const prevParams = ((meta.template as { params?: Record<string, unknown> } | undefined)?.params) ?? {};
        const template = templateFor(d, mergeAdditions(additionFromParams(prevParams), d.add));
        const content = notificationContent(template);
        const next = JSON.stringify({ ...meta, template });
        const won = await db.update(notifications)
            .set({ title: content.title, body: content.body, metadata: next, read: 0, dismissed: 0 })
            .where(and(eq(notifications.id, id), row.metadata === null ? sql`${notifications.metadata} IS NULL` : eq(notifications.metadata, row.metadata)))
            .returning({ id: notifications.id });
        if (won.length) {
            logger.info('profileAdditionNotices: merged into the recent notice', { ...ctx, notificationId: id });
            return true;
        }
    }
    logger.warn('profileAdditionNotices: merge kept losing the race, a fresh notice may follow', { ...ctx, notificationId: id });
    return false;
}
