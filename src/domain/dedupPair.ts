/**
 * Who may merge a pending duplicate pair from /my-adopters, and which side
 * survives. Pure — mergePendingDedupPair (src/app/actions/duplicates.ts)
 * fetches the inputs and runs the shared merge.
 *
 * 1. Eligibility is the rule getPendingDuplicatesForUser lists the pair by:
 *    the caller created (`addedBy`) at least one LIVE side.
 * 2. Ownership — never age — decides what may be ABSORBED. The older record
 *    survives (as the card shows), and the absorbed (newer) one must be the
 *    caller's own or a teammate's. A foreign record is never absorbed into
 *    the caller's: that would soft-delete another rescuer's profile and hand
 *    its full contact to the caller — and `createdAt` is not trustworthy
 *    enough to be the only guard. The same pair also sits in the other
 *    owner's feed, where it is THEIR record being absorbed; they or an admin
 *    can merge it. (Same precedent as planFormLink: the only record ever
 *    absorbed is the rescuer's own.)
 * 3. A manually filed duplicate FLAG needs both sides in the caller's team:
 *    flags are user-filed, so a flag across owners goes to the admin queue.
 */

export interface DedupSide {
    id: string;
    addedBy: string | null;
    createdAt: number | null; // epoch ms
    deleted: boolean;
    /** The caller created this record or shares a team with whoever did. */
    teamOwned: boolean;
}

export type DedupRefusal = 'unauthenticated' | 'not_found' | 'not_yours' | 'other_owner' | 'flag_cross_owner';

export type DedupMergeDecision =
    | { ok: true; primaryId: string; secondaryId: string }
    | { ok: false; reason: DedupRefusal };

export function decideDedupMerge(
    actor: string | null | undefined,
    a: DedupSide | null | undefined,
    b: DedupSide | null | undefined,
    source: 'detected' | 'flag' = 'detected',
): DedupMergeDecision {
    if (!actor) return { ok: false, reason: 'unauthenticated' };
    if (!a || !b || a.deleted || b.deleted || a.id === b.id) return { ok: false, reason: 'not_found' };
    const created = (s: DedupSide) => !!s.addedBy && s.addedBy === actor;
    if (!created(a) && !created(b)) return { ok: false, reason: 'not_yours' };
    if (source === 'flag' && !(a.teamOwned && b.teamOwned)) return { ok: false, reason: 'flag_cross_owner' };
    // The card's order: the NEWER record is "the new submission", the older is
    // "the existing profile" and survives; ties keep `a` as the new one.
    const aMs = a.createdAt ?? 0;
    const bMs = b.createdAt ?? 0;
    const newer = aMs >= bMs ? a : b;
    const older = newer === a ? b : a;
    if (!newer.teamOwned) return { ok: false, reason: 'other_owner' };
    return { ok: true, primaryId: older.id, secondaryId: newer.id };
}

/** A duplicate flag row, as far as the merge feed cares. */
export interface DuplicateFlagRow {
    adopterId: string;
    targetAdopterId: string | null;
    reason: string | null;
    details: string | null;
}

/** Marker mergeAdopters writes into a flag's details once its pair is merged. */
export const MERGED_FLAG_DETAILS_PREFIX = 'Merged into ';

/**
 * Whether a manual duplicate flag is still an open question. Flags carry no
 * status column: dismissing one deletes the row (dismissFlag), and merging
 * annotates it (`details` = "Merged into …") and re-points the absorbed side's
 * flags onto the survivor — which can leave a flag pointing at itself. None of
 * those are pairs to show or merge.
 */
export function isOpenDuplicateFlag(f: DuplicateFlagRow): boolean {
    if (f.reason !== 'duplicate' || !f.targetAdopterId) return false;
    if (f.adopterId === f.targetAdopterId) return false;
    return !(f.details ?? '').startsWith(MERGED_FLAG_DETAILS_PREFIX);
}
