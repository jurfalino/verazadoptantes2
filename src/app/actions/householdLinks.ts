'use server';

/**
 * «No convive» (D48, replaces the withdrawn D47 «Quitar de mi perfil»): the
 * linked profile's owner, a teammate or an admin says the person does not
 * live with that host. It corrects the fact for everyone: the member leaves
 * the host's household and the link goes — on both profiles — with history on
 * both and the host's owner team told. If the host's side puts the person
 * back, the admins hear about the disagreement (src/lib/householdLinks.ts).
 *
 * Browser-callable: takes only a link id. The session is the only source of
 * the actor; a guessed id of someone else's link is refused (not the linked
 * profile's team) and reads the same as a missing one.
 */
import { getDb, getUser } from './_db';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { isRealActorEmail } from '@/lib/piiAccess';
import { applyNotLivingTogether, loadLinkForCorrection } from '@/lib/householdLinks';
import { canReportNotLivingTogether } from '@/domain/householdLinks';

type ReportResult = { success: true } | { success: false; error: 'not_authenticated' | 'not_found' | 'failed'; errorId?: string };

export async function reportNotLivingTogether(linkId: string): Promise<ReportResult> {
    let actor = '';
    try { actor = await getUser(); } catch { /* anonymous: refused below */ }
    if (!isRealActorEmail(actor)) return { success: false, error: 'not_authenticated' };
    const id = typeof linkId === 'string' ? linkId.slice(0, 200) : '';
    const ctx = { linkId: id, actor };
    try {
        const db = await getDb();
        if (!db) throw new Error('No database');
        const target = await loadLinkForCorrection(db, id);
        if (!target) return { success: false, error: 'not_found' };
        const [{ isAdminAsync }, { isOwnerOrOrgMate }] = await Promise.all([import('@/config/admins'), import('@/lib/orgMembership')]);
        const [viewerIsAdmin, viewerIsLinkedOwnerTeam] = await Promise.all([isAdminAsync(actor), isOwnerOrOrgMate(actor, target.linked.addedBy)]);
        if (!canReportNotLivingTogether({ viewerIsAdmin, viewerIsLinkedOwnerTeam })) {
            logger.warn('reportNotLivingTogether: not the linked profile team', { ...ctx, linkedId: target.linked.id });
            return { success: false, error: 'not_found' };
        }
        // Privileged on the HOST too? (admin/moderator or its owner team) — else the host's history row is a contribution.
        const { isModeratorOrAdminAsync } = await import('@/config/admins');
        const [hostAdmin, hostTeam] = await Promise.all([isModeratorOrAdminAsync(actor), isOwnerOrOrgMate(actor, target.host.addedBy)]);
        const out = await applyNotLivingTogether(db, target, actor, { hostKind: hostAdmin || hostTeam ? 'edit' : 'contribution' });
        if (out.busyErrorId) return { success: false, error: 'failed', errorId: out.busyErrorId };
        if (!out.removed) return { success: false, error: 'not_found' };
        logAudit({ userEmail: actor, action: 'household_not_living_together', target: target.linked.id, details: { linkId: id, hostId: target.host.id, memberId: target.link.memberId } });
        return { success: true };
    } catch (e) {
        const errorId = logger.error('reportNotLivingTogether failed', e, ctx);
        return { success: false, error: 'failed', errorId };
    }
}
