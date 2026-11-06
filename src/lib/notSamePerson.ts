import { and, eq, or } from 'drizzle-orm';
import { adopters, duplicateCandidates } from '@/db/schema';
import { isAdminAsync } from '@/config/admins';
import { keepOffered } from '@/domain/rejectedCandidates';
import { logger } from '@/lib/logger';
import { recordSeparatePairs } from '@/lib/mergeRequests';
import type { getDb } from '@/lib/db';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export interface NotSamePersonAsked {
    otherId: string;
    otherName: string;
    /** Who will see the question in «Pendientes»: each profile's owner, by org name, else display name. */
    ownerLabels: string[];
}

const sameEmail = (a: string | null | undefined, b: string) => !!a && a.trim().toLowerCase() === b.trim().toLowerCase();

async function ownerLabel(email: string | null, viewer: string): Promise<string | null> {
    if (!email || email === 'anonymous') return null;
    try {
        const { pickAttributionOrg } = await import('@/lib/orgMembership');
        const org = await pickAttributionOrg(email, viewer);
        if (org?.name) return org.name;
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
 * - Who settles it: the person who loaded either profile, or an admin — the rule of
 *   «Mantener separados» (step 2 widens it to their teams). Settled = a dismissed pair.
 * - Anyone else: the pair is opened for the owners (a pending, medium row, so it shows
 *   in «Pendientes») when none exists yet, and the caller is told who was asked.
 * - A pair already settled (dismissed / merged) is never touched.
 * Never throws: a failure is logged with `ctx`; the caller's own action stands.
 */
export async function settleNotSamePerson(db: Db, input: {
    actor: string;
    adopterId: string;
    rejectedIds: readonly unknown[] | undefined;
    offered: ReadonlyArray<{ adopterId: string; matchTypes?: string[] }>;
    ctx: Record<string, unknown>;
}): Promise<{ recorded: string[]; asked: NotSamePersonAsked[]; dropped: number }> {
    const { actor, adopterId, ctx } = input;
    const { kept, dropped } = keepOffered((input.rejectedIds ?? []).slice(0, 10), input.offered.map(o => o.adopterId).filter(id => id !== adopterId));
    if (dropped) logger.warn('settleNotSamePerson: rejected id not offered, ignored', { ...ctx, actor, adopterId, dropped });
    const recorded: string[] = [];
    const asked: NotSamePersonAsked[] = [];
    if (kept.length === 0) return { recorded, asked, dropped };
    try {
        const row = (id: string) => db.select({ name: adopters.name, addedBy: adopters.addedBy }).from(adopters).where(eq(adopters.id, id)).get() as Promise<{ name: string; addedBy: string | null } | undefined>;
        const [self, admin] = await Promise.all([row(adopterId), isAdminAsync(actor)]);
        if (!self) return { recorded, asked, dropped };
        for (const otherId of kept) {
            const other = await row(otherId);
            if (!other) continue;
            if (admin || sameEmail(self.addedBy, actor) || sameEmail(other.addedBy, actor)) {
                await recordSeparatePairs(db, adopterId, [otherId], actor, { ...ctx, adopterId });
                recorded.push(otherId);
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
        }
    } catch (e) {
        logger.error('settleNotSamePerson: «no es la misma persona» not saved', e, { ...ctx, actor, adopterId });
    }
    return { recorded, asked, dropped };
}
