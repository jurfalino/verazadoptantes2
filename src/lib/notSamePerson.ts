import { and, eq, or } from 'drizzle-orm';
import { adopters, duplicateCandidates } from '@/db/schema';
import { isAdminAsync } from '@/config/admins';
import { keepOffered } from '@/domain/rejectedCandidates';
import { logger } from '@/lib/logger';
import { recordSeparatePairs } from '@/lib/mergeRequests';
import { getOrgsForEmail, isOwnerOrOrgMate } from '@/lib/orgMembership';
import type { getDb } from '@/lib/db';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export interface NotSamePersonAsked {
    otherId: string;
    otherName: string;
    /**
     * Who will see the question in «Pendientes»: each profile's owner — their group's name
     * when the viewer is in it, else their display name. Empty when neither profile has an
     * owner: the screen then says «los administradores».
     */
    ownerLabels: string[];
}

/** The actor or a teammate loaded it (step 2: the team acts as one; case-insensitive). */
async function teamLoaded(actor: string, addedBy: string | null | undefined): Promise<boolean> {
    return isOwnerOrOrgMate(actor, addedBy);
}

async function ownerLabel(email: string | null, viewer: string): Promise<string | null> {
    if (!email || email === 'anonymous') return null;
    try {
        // The owner's group is named only to someone in it — the profile byline's rule
        // (v2.18.15: strangers see a name, never org membership). Otherwise a display name.
        const [ownerOrgs, viewerOrgs] = await Promise.all([getOrgsForEmail(email), getOrgsForEmail(viewer)]);
        const shared = ownerOrgs.find(o => viewerOrgs.some(v => v.id === o.id));
        if (shared?.name) return shared.name;
        const { resolveDisplayName } = await import('@/app/actions/notifications');
        return (await resolveDisplayName(email)) || email.split('@')[0];
    } catch (e) {
        logger.warn('settleNotSamePerson: owner label unresolved, using the handle', { viewer, error: e instanceof Error ? e.message : String(e) });
        return email.split('@')[0];
    }
}

/**
 * The consistency rule (spec 2026-11-06): a «no, it's not this person» about an
 * existing profile is ONE answer, saved the same way on every screen.
 *
 * - Only ids the server's own search `offered` count (keepOffered): a forged id writes nothing.
 * - Who settles it: the team (the loader or an org-mate) of either profile, or an admin —
 *   the rule of «Mantener separados» (step 2: the team acts as one). Settled = a dismissed pair.
 * - Anyone else: the pair is opened for the owners (a pending, medium row, so it shows
 *   in «Pendientes») when none exists yet, and the caller is told who was asked.
 * - A pair already settled (dismissed / merged) is never touched.
 * Never throws: an id it could not save comes back in `failed` with the logged errorId,
 * so the caller says so; the caller's own action stands.
 */
export async function settleNotSamePerson(db: Db, input: {
    actor: string;
    adopterId: string;
    rejectedIds: readonly unknown[] | undefined;
    offered: ReadonlyArray<{ adopterId: string; matchTypes?: string[] }>;
    ctx: Record<string, unknown>;
    /**
     * Who may settle: 'either' (default) — the team of either profile's loader, as «Mantener
     * separados»; 'subject' — only the team of `adopterId`'s loader (or an admin). The contact
     * window uses 'subject': its search runs on a contact the caller typed, which proves
     * nothing about `adopterId`, so the other side's owner may only ask (review 2026-11-06).
     */
    settleBy?: 'either' | 'subject';
}): Promise<{ recorded: string[]; asked: NotSamePersonAsked[]; dropped: number; failed: string[]; errorId?: string }> {
    const { actor, adopterId, ctx } = input;
    const { kept, dropped } = keepOffered((input.rejectedIds ?? []).slice(0, 10), input.offered.map(o => o.adopterId).filter(id => id !== adopterId));
    if (dropped) logger.warn('settleNotSamePerson: rejected id not offered, ignored', { ...ctx, actor, adopterId, dropped });
    const recorded: string[] = [];
    const asked: NotSamePersonAsked[] = [];
    const failed: string[] = [];
    let errorId: string | undefined;
    const result = () => ({ recorded, asked, dropped, failed, ...(errorId ? { errorId } : {}) });
    if (kept.length === 0) return result();
    const row = (id: string) => db.select({ name: adopters.name, addedBy: adopters.addedBy }).from(adopters).where(eq(adopters.id, id)).get() as Promise<{ name: string; addedBy: string | null } | undefined>;
    let self: { name: string; addedBy: string | null } | undefined;
    let admin = false;
    try {
        [self, admin] = await Promise.all([row(adopterId), isAdminAsync(actor)]);
    } catch (e) {
        failed.push(...kept);
        errorId = logger.error('settleNotSamePerson: profiles unreadable, «no» not saved', e, { ...ctx, actor, adopterId });
        return result();
    }
    if (!self) return result();
    // The subject's side is the same for every id: checked once (the review's minor).
    let selfTeam = false;
    try { selfTeam = admin || await teamLoaded(actor, self.addedBy); } catch (e) {
        logger.warn('settleNotSamePerson: team check failed, solo rule', { ...ctx, actor, adopterId, error: e instanceof Error ? e.message : String(e) });
    }
    // One id at a time: a failure on one never skips the rest, and each is reported.
    for (const otherId of kept) {
        try {
            const other = await row(otherId);
            if (!other) continue;
            const settles = selfTeam || (input.settleBy !== 'subject' && await teamLoaded(actor, other.addedBy));
            if (settles) {
                const wrote = await recordSeparatePairs(db, adopterId, [otherId], actor, { ...ctx, adopterId });
                if (wrote.failed.length) { failed.push(otherId); errorId = wrote.errorId ?? errorId; }
                else recorded.push(otherId);
                continue;
            }
            const existing = await db.select({ id: duplicateCandidates.id }).from(duplicateCandidates)
                .where(or(
                    and(eq(duplicateCandidates.adopter1Id, adopterId), eq(duplicateCandidates.adopter2Id, otherId)),
                    and(eq(duplicateCandidates.adopter1Id, otherId), eq(duplicateCandidates.adopter2Id, adopterId)),
                )).get();
            if (existing) continue; // already open (the owners see it) or already settled
            const [adopter1Id, adopter2Id] = adopterId < otherId ? [adopterId, otherId] : [otherId, adopterId];
            const matchTypes = input.offered.find(o => o.adopterId === otherId)?.matchTypes ?? [];
            await db.insert(duplicateCandidates).values({
                id: crypto.randomUUID(), adopter1Id, adopter2Id,
                matchTypes: JSON.stringify(matchTypes), matchValues: '{}', score: 30, confidence: 'medium', status: 'pending',
            });
            const labels = (await Promise.all([ownerLabel(self.addedBy, actor), ownerLabel(other.addedBy, actor)])).filter((l): l is string => !!l);
            asked.push({ otherId, otherName: other.name, ownerLabels: [...new Set(labels)] });
        } catch (e) {
            failed.push(otherId);
            errorId = logger.error('settleNotSamePerson: «no es la misma persona» not saved', e, { ...ctx, actor, adopterId, otherId });
        }
    }
    return result();
}
