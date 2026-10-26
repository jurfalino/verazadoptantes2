/**
 * The pair verdict (src/domain/dedupPair.ts pairVerdict / mergeNeedsAdmins)
 * read from the database: every merge request and every merge dispute between
 * two profiles, either orientation — two bounded queries, never `IN (…)`.
 * Consulted by EVERY non-admin merge entry point: the «Pendientes» feed and
 * click (mergePendingDedupPair, through pairChoices), and the contract / form
 * folds (attachContractToExistingAdopter, linkFormToExistingAdopter, through
 * refuseDisputedMerge). A plain server module, NOT 'use server'.
 */

import { and, eq, or } from 'drizzle-orm';
import { adopters, mergeDisputes, mergeRequests } from '@/db/schema';
import type { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { getTeamEmails, isOwnerOrOrgMate, normEmail } from '@/lib/orgMembership';
import { isAdminAsync } from '@/config/admins';
import { mergeNeedsAdmins, pairVerdict, type MergeDisputeStatus, type MergeRequestStatus, type PairVerdict } from '@/domain/dedupPair';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** The viewer and their teammates, normalized (a decline holds for the team) — the same team the feed uses. */
export async function teamOf(viewer: string): Promise<string[]> {
    const team = await getTeamEmails(viewer);
    return [...new Set([viewer, ...team].map(normEmail).filter(Boolean))];
}

/** What has been said about the pair (a, b), as seen by `viewerTeam`. */
export async function loadPairVerdict(db: Db, a: string, b: string, viewerTeam: readonly string[]): Promise<PairVerdict> {
    const [requests, disputes] = await Promise.all([
        db.select({ requesterEmail: mergeRequests.requesterEmail, status: mergeRequests.status }).from(mergeRequests).where(or(
            and(eq(mergeRequests.primaryId, a), eq(mergeRequests.secondaryId, b)),
            and(eq(mergeRequests.primaryId, b), eq(mergeRequests.secondaryId, a)),
        )).all() as Promise<Array<{ requesterEmail: string; status: MergeRequestStatus }>>,
        db.select({ status: mergeDisputes.status }).from(mergeDisputes).where(or(
            and(eq(mergeDisputes.survivorId, a), eq(mergeDisputes.absorbedId, b)),
            and(eq(mergeDisputes.survivorId, b), eq(mergeDisputes.absorbedId, a)),
        )).all() as Promise<Array<{ status: MergeDisputeStatus }>>,
    ]);
    return pairVerdict({ requests, disputes }, viewerTeam);
}

/**
 * Before a rescuer folds `absorbedId` into `keepId` outside «Pendientes»: true
 * when the pair verdict says the admins must decide (mergeNeedsAdmins) — the
 * caller refuses with 'pair_disputed'. Admins are never refused.
 */
export async function refuseDisputedMerge(db: Db, input: { keepId: string; absorbedId: string; actor: string }): Promise<boolean> {
    if (await isAdminAsync(input.actor)) return false;
    const [team, keep] = await Promise.all([
        teamOf(input.actor),
        db.select({ addedBy: adopters.addedBy }).from(adopters).where(eq(adopters.id, input.keepId)).get(),
    ]);
    const [verdict, keepTeamOwned] = await Promise.all([
        loadPairVerdict(db, input.keepId, input.absorbedId, team),
        isOwnerOrOrgMate(input.actor, keep?.addedBy ?? null),
    ]);
    const refused = mergeNeedsAdmins(verdict, keepTeamOwned);
    if (refused) logger.info('refuseDisputedMerge: the admins decide this pair', { primaryId: input.keepId, secondaryId: input.absorbedId, actor: input.actor, ...verdict });
    return refused;
}
