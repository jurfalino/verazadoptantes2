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

export type DedupAction =
    | { kind: 'merge'; primaryId: string; secondaryId: string; notifyOwner: string | null }
    | { kind: 'request'; primaryId: string; secondaryId: string; ownerEmail: string | null }
    | { kind: 'refuse'; reason: DedupRefusal };

/**
 * Only an email is a real owner to notify or ask. null / '' / 'anonymous' and
 * system markers such as 'system-demo' (in production `added_by`) have none.
 */
export function realOwner(addedBy: string | null | undefined): string | null {
    return addedBy && addedBy.includes('@') ? addedBy : null;
}

/**
 * Merge directly or ask? The older record always survives. The viewer merges
 * straight away only when the absorbed (newer) side is team-owned and, for a
 * hand-filed flag, only when BOTH sides are; otherwise the owner of the
 * foreign side is asked (request).
 */
export function decideDedupAction(
    actor: string | null | undefined,
    a: DedupSide | null | undefined,
    b: DedupSide | null | undefined,
    source: 'detected' | 'flag' = 'detected',
): DedupAction {
    if (!actor) return { kind: 'refuse', reason: 'unauthenticated' };
    if (!a || !b || a.deleted || b.deleted || a.id === b.id) return { kind: 'refuse', reason: 'not_found' };
    const created = (s: DedupSide) => !!s.addedBy && s.addedBy === actor;
    if (!created(a) && !created(b)) return { kind: 'refuse', reason: 'not_yours' };
    // The card's order: the NEWER record is "the new submission", the older is
    // "the existing profile" and survives; ties keep `a` as the new one.
    const newer = (a.createdAt ?? 0) >= (b.createdAt ?? 0) ? a : b;
    const older = newer === a ? b : a;
    const ids = { primaryId: older.id, secondaryId: newer.id };
    if (newer.teamOwned && older.teamOwned) return { kind: 'merge', ...ids, notifyOwner: null };
    if (source === 'flag') {
        const foreign = newer.teamOwned ? older : newer;
        return { kind: 'request', ...ids, ownerEmail: realOwner(foreign.addedBy) };
    }
    if (newer.teamOwned) return { kind: 'merge', ...ids, notifyOwner: realOwner(older.addedBy) };
    return { kind: 'request', ...ids, ownerEmail: realOwner(newer.addedBy) };
}

export function decideDedupMerge(
    actor: string | null | undefined,
    a: DedupSide | null | undefined,
    b: DedupSide | null | undefined,
    source: 'detected' | 'flag' = 'detected',
): DedupMergeDecision {
    const d = decideDedupAction(actor, a, b, source);
    if (d.kind === 'refuse') return { ok: false, reason: d.reason };
    if (d.kind === 'request') return { ok: false, reason: source === 'flag' ? 'flag_cross_owner' : 'other_owner' };
    return { ok: true, primaryId: d.primaryId, secondaryId: d.secondaryId };
}

export type MergeRequestStatus =
    | 'pending' | 'accepted' | 'declined' | 'cancelled' | 'admin_approved' | 'admin_declined' | 'closed';

export type MergeRequestAnswer =
    | { ok: true; nextStatus: MergeRequestStatus; merges: boolean }
    | { ok: false; reason: 'not_allowed' | 'not_open' };

/** Who may accept / decline / cancel a merge request, and what status results. */
export function decideMergeRequestAnswer(input: {
    status: MergeRequestStatus;
    actorIsRequester: boolean;
    actorOnOwnerTeam: boolean;
    actorIsAdmin: boolean;
    decision: 'accept' | 'decline' | 'cancel';
}): MergeRequestAnswer {
    const { status, actorIsRequester, actorOnOwnerTeam, actorIsAdmin, decision } = input;
    const next = (nextStatus: MergeRequestStatus, merges = false): MergeRequestAnswer => ({ ok: true, nextStatus, merges });
    const notAllowed: MergeRequestAnswer = { ok: false, reason: 'not_allowed' };
    const notOpen: MergeRequestAnswer = { ok: false, reason: 'not_open' };

    if (status !== 'pending' && status !== 'declined') return notOpen;
    if (status === 'declined') {
        // Only an admin can still approve a declined request.
        return actorIsAdmin && decision === 'accept' ? next('admin_approved', true) : notOpen;
    }
    // status === 'pending'
    if (decision === 'cancel') return actorIsRequester ? next('cancelled') : notAllowed;
    const asOwner = actorOnOwnerTeam && !actorIsRequester;
    if (asOwner) return decision === 'accept' ? next('accepted', true) : next('declined');
    if (actorIsAdmin) return decision === 'accept' ? next('admin_approved', true) : next('admin_declined');
    return notAllowed;
}

/** A duplicate flag row, as far as the merge feed cares. */
export interface DuplicateFlagRow {
    adopterId: string;
    targetAdopterId?: string | null;
    reason?: string | null;
    details?: string | null;
}

/** Marker mergeAdopters writes into a flag's details once its pair is merged. */
export const MERGED_FLAG_DETAILS_PREFIX = 'Merged into ';

/**
 * Marker a declined merge request writes into its flag's details, followed by
 * the request id — never who declined: flag details render to every viewer of
 * the profile. The pair was resolved as kept-separate (spec D4b).
 */
export const KEPT_SEPARATE_FLAG_DETAILS_PREFIX = 'Kept separate: ';

/**
 * Whether a manual duplicate flag is still an open question. Flags carry no
 * status column: dismissing one deletes the row (dismissFlag), merging
 * annotates it (`details` = "Merged into …") and re-points the absorbed side's
 * flags onto the survivor — which can leave a flag pointing at itself — and a
 * declined merge request annotates it "Kept separate: …". None of those are
 * pairs to show or merge.
 */
export function isOpenDuplicateFlag(f: DuplicateFlagRow): boolean {
    if (f.reason !== 'duplicate' || !f.targetAdopterId) return false;
    if (f.adopterId === f.targetAdopterId) return false;
    const details = f.details ?? '';
    return !details.startsWith(MERGED_FLAG_DETAILS_PREFIX) && !details.startsWith(KEPT_SEPARATE_FLAG_DETAILS_PREFIX);
}
