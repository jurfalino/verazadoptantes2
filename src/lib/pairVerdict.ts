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
import { adopterFlags, adopters, mergeDisputes, mergeRequests } from '@/db/schema';
import type { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { getTeamEmails, isOwnerOrOrgMate, normEmail } from '@/lib/orgMembership';
import { isAdminAsync } from '@/config/admins';
import { isOpenDuplicateFlag, mergeNeedsAdmins, pairVerdict, type MergeDisputeStatus, type MergeRequestStatus, type PairVerdict } from '@/domain/dedupPair';

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

/**
 * Is the pair (a, b) already up for review? `flagId`: an open duplicate flag
 * on it, either direction (isOpenDuplicateFlag: not merged, not kept
 * separate); `requestPending`: a pending merge request on it, either
 * orientation. Two bounded queries, never `IN (…)`. Throws on a DB error —
 * the caller decides.
 */
export async function pairUnderReview(db: Db, a: string, b: string): Promise<{ flagId: string | null; requestPending: boolean }> {
    const [flags, request] = await Promise.all([
        db.select({ id: adopterFlags.id, adopterId: adopterFlags.adopterId, targetAdopterId: adopterFlags.targetAdopterId, reason: adopterFlags.reason, details: adopterFlags.details })
            .from(adopterFlags).where(and(eq(adopterFlags.reason, 'duplicate'), or(
                and(eq(adopterFlags.adopterId, a), eq(adopterFlags.targetAdopterId, b)),
                and(eq(adopterFlags.adopterId, b), eq(adopterFlags.targetAdopterId, a)),
            ))).all() as Promise<Array<{ id: string; adopterId: string; targetAdopterId: string | null; reason: string | null; details: string | null }>>,
        db.select({ id: mergeRequests.id }).from(mergeRequests).where(and(
            or(
                and(eq(mergeRequests.primaryId, a), eq(mergeRequests.secondaryId, b)),
                and(eq(mergeRequests.primaryId, b), eq(mergeRequests.secondaryId, a)),
            ),
            eq(mergeRequests.status, 'pending'),
        )).get() as Promise<{ id: string } | undefined>,
    ]);
    const open = flags.find(f => isOpenDuplicateFlag(f));
    return { flagId: open?.id ?? null, requestPending: !!request };
}
