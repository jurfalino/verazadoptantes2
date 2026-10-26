'use server';

/**
 * «Quitar de mi perfil» (D47): the linked profile's owner, a teammate or an
 * admin takes a «Convive con» row off that profile. Only the link is hidden
 * (for everyone); the host's household member is the host owner's data and
 * stays. The host's owner is told.
 *
 * Browser-callable: takes only a link id. The session is the only source of
 * the actor; a guessed id of someone else's link is refused (not the linked
 * profile's team) and reads the same as a missing one.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { getDb, getUser } from './_db';
import { adopters, householdLinks } from '@/db/schema';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { isRealActorEmail } from '@/lib/piiAccess';
import { runAfterResponse } from '@/lib/background';
import { canHideHouseholdLink, personLabel } from '@/domain/householdLinks';
import { realOwner } from '@/domain/dedupPair';
import { notificationContent } from '@/domain/notificationTemplates';

type HideResult = { ok: true } | { ok: false; error: 'not_authenticated' | 'not_found' | 'failed'; errorId?: string };

export async function hideHouseholdLink(linkId: string): Promise<HideResult> {
    let actor = '';
    try { actor = await getUser(); } catch { /* anonymous: refused below */ }
    if (!isRealActorEmail(actor)) return { ok: false, error: 'not_authenticated' };
    const id = typeof linkId === 'string' ? linkId.slice(0, 200) : '';
    const ctx = { linkId: id, actor };
    try {
        const db = await getDb();
        if (!db) throw new Error('No database');
        const link = await db.select().from(householdLinks).where(eq(householdLinks.id, id)).get();
        if (!link) return { ok: false, error: 'not_found' };
        const linked = await db.select({ name: adopters.name, addedBy: adopters.addedBy })
            .from(adopters).where(eq(adopters.id, link.linkedAdopterId)).get();
        if (!linked) return { ok: false, error: 'not_found' };
        const [{ isAdminAsync }, { isOwnerOrOrgMate }] = await Promise.all([import('@/config/admins'), import('@/lib/orgMembership')]);
        const [viewerIsAdmin, viewerIsLinkedOwnerTeam] = await Promise.all([isAdminAsync(actor), isOwnerOrOrgMate(actor, linked.addedBy)]);
        if (!canHideHouseholdLink({ viewerIsAdmin, viewerIsLinkedOwnerTeam })) {
            logger.warn('hideHouseholdLink: not the linked profile team', { ...ctx, linkedId: link.linkedAdopterId });
            return { ok: false, error: 'not_found' };
        }
        if (link.hiddenAt) return { ok: true }; // already off the profile
        const written = await db.update(householdLinks)
            .set({ hiddenAt: new Date(), hiddenBy: actor })
            .where(and(eq(householdLinks.id, id), isNull(householdLinks.hiddenAt)))
            .returning({ id: householdLinks.id });
        logAudit({ userEmail: actor, action: 'household_link_hidden', target: link.linkedAdopterId, details: { linkId: id, hostId: link.hostAdopterId } });
        logger.info('hideHouseholdLink: hidden', { ...ctx, hostId: link.hostAdopterId, linkedId: link.linkedAdopterId, wrote: written.length > 0 });
        if (written.length > 0) await notifyHostOwner(link.hostAdopterId, linked.name, actor, ctx);
        return { ok: true };
    } catch (e) {
        const errorId = logger.error('hideHouseholdLink failed', e, ctx);
        return { ok: false, error: 'failed', errorId };
    }
}

/** The host's owner hears that the other side took the row off (D47). Never the actor. */
async function notifyHostOwner(hostId: string, linkedName: string, actor: string, ctx: Record<string, unknown>): Promise<void> {
    await runAfterResponse('household.link_hidden', async () => {
        const db = await getDb();
        if (!db) return;
        const host = await db.select({ name: adopters.name, addedBy: adopters.addedBy }).from(adopters).where(eq(adopters.id, hostId)).get();
        const owner = realOwner(host?.addedBy ?? null)?.trim().toLowerCase();
        if (!host || !owner || owner === actor.trim().toLowerCase()) {
            logger.info('hideHouseholdLink: host owner not notified (none, or the actor)', { ...ctx, hostId });
            return;
        }
        const [{ createNotification }, { resolveUserNames }] = await Promise.all([import('./notifications'), import('./userNames')]);
        const actorName = personLabel(actor, await resolveUserNames([actor])) ?? '';
        await createNotification({
            userId: owner,
            type: 'household_link_hidden',
            ...notificationContent({ key: 'household_link_hidden', params: { actorName, hostName: host.name, linkedName } }),
            url: `/adopter/${hostId}`,
            icon: '🏠',
            metadata: { hostId, linkId: ctx.linkId },
        });
    }, { ...ctx, hostId });
}
