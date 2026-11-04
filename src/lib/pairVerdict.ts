/**
 * The pair verdict (src/domain/dedupPair.ts pairVerdict / mergeNeedsAdmins)
 * read from the database: every merge request and every merge dispute between
 * two profiles, either orientation — two bounded queries, never `IN (…)`.
 * Consulted by EVERY non-admin merge entry point: the «Pendientes» feed and
 * click (mergePendingDedupPair, through pairChoices), and the contract / form
 * folds (attachContractToExistingAdopter, linkFormToExistingAdopter, through
 * refuseDisputedMerge). A plain server module, NOT 'use server'.
 */

import { and, eq, or, sql } from 'drizzle-orm';
import { adopterFlags, adopters, duplicateCandidates, mergeDisputes, mergeRequests } from '@/db/schema';
import type { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { getTeamEmails, isOwnerOrOrgMate, normEmail } from '@/lib/orgMembership';
import { isAdminAsync } from '@/config/admins';
import { sharesHomeSql } from '@/lib/housemateSql';
import { deserializeContactEntries, parseBlobToContactEntries, sameContact } from '@/lib/contactEntries';
import { isOpenDuplicateFlag, KEPT_SEPARATE_FLAG_DETAILS_PREFIX, mergeNeedsAdmins, pairVerdict, type MergeDisputeStatus, type MergeRequestStatus, type PairVerdict } from '@/domain/dedupPair';

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

export type SettledSeparate = 'household' | 'kept_separate';

/** The marker «Viven juntos» writes on the pair's flags (keepAsHousehold in src/app/actions/duplicates.ts). */
const HOUSEHOLD_MARKER = `${KEPT_SEPARATE_FLAG_DETAILS_PREFIX}household`;

/**
 * Is the pair (a, b) already settled as TWO people (F3, Jon 2026-10-29,
 * option a)? The same facts «Pendientes de revisar» reads to keep a pair off
 * its list:
 * - 'household': the two share an ordinary household (sharesHomeSql — gift
 *   households don't count), unless they share a personal identifier (an
 *   email or ID number, sameContact): «Pendientes» hides housemates only then
 *   (hiddenAsHousematesSql / sharesPersonalIdentifier, final fix S3).
 * - 'kept_separate': a detected candidate on the pair was dismissed
 *   («Mantener separados», by a rescuer OR an admin — «Pendientes» hides that
 *   pair from everyone and offers nothing, round 6), or a duplicate flag on it
 *   carries the «Viven juntos» marker (`Kept separate: household`).
 * A ruling pairVerdict records — an admin declining a request, an admin undoing
 * a disputed merge — is NOT settled: «Pendientes» lets it be disputed (D49/D50),
 * so the window keeps «Pedir revisión a un administrador» (case 4). Those
 * rulings also dismiss the pair's candidates (keepSeparate), so a dismissal on
 * a pair with such a ruling is read as the ruling, not as «Mantener separados».
 * Bounded queries, either orientation, never `IN (…)`. Throws on a DB error.
 */
export async function pairSettledSeparate(db: Db, a: string, b: string): Promise<SettledSeparate | null> {
    const [home, dismissed, flags] = await Promise.all([
        db.select({ one: sql<number>`1` }).from(adopters).where(and(eq(adopters.id, a), sharesHomeSql(sql`${a}`, sql`${b}`))).get() as Promise<{ one: number } | undefined>,
        db.select({ id: duplicateCandidates.id }).from(duplicateCandidates).where(and(
            eq(duplicateCandidates.status, 'dismissed'),
            or(
                and(eq(duplicateCandidates.adopter1Id, a), eq(duplicateCandidates.adopter2Id, b)),
                and(eq(duplicateCandidates.adopter1Id, b), eq(duplicateCandidates.adopter2Id, a)),
            ),
        )).get() as Promise<{ id: string } | undefined>,
        db.select({ details: adopterFlags.details }).from(adopterFlags).where(and(eq(adopterFlags.reason, 'duplicate'), or(
            and(eq(adopterFlags.adopterId, a), eq(adopterFlags.targetAdopterId, b)),
            and(eq(adopterFlags.adopterId, b), eq(adopterFlags.targetAdopterId, a)),
        ))).all() as Promise<Array<{ details: string | null }>>,
    ]);
    if (flags.some(f => (f.details ?? '') === HOUSEHOLD_MARKER)) return 'kept_separate';
    // «Mantener separados» — unless the dismissal came from a recorded admin ruling (disputable, case 4).
    if (dismissed && !(await loadPairVerdict(db, a, b, [])).adminRuledSeparate) return 'kept_separate';
    if (home && !(await sharePersonalIdentifier(db, a, b))) return 'household';
    return null;
}

/** The two profiles carry the same email or ID number, as the matcher compares them. */
async function sharePersonalIdentifier(db: Db, a: string, b: string): Promise<boolean> {
    const read = (id: string) => db.select({ contactEntries: adopters.contactEntries, contactInfo: adopters.contactInfo })
        .from(adopters).where(eq(adopters.id, id)).get() as Promise<{ contactEntries: string | null; contactInfo: string | null } | undefined>;
    const personal = (r: { contactEntries: string | null; contactInfo: string | null } | undefined) => {
        const parsed = deserializeContactEntries(r?.contactEntries ?? null);
        return (parsed.length > 0 ? parsed : parseBlobToContactEntries(r?.contactInfo ?? null)).filter(e => e.type === 'email' || e.type === 'id');
    };
    const [ra, rb] = await Promise.all([read(a), read(b)]);
    const pa = personal(ra), pb = personal(rb);
    return pa.some(x => pb.some(y => sameContact(x, y)));
}
