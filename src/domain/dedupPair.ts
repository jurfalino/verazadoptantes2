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
 *
 * v2 («Pendientes de revisar» D, spec 2026-10-25): the rescuer CHOOSES which
 * profile stays (`keepId`, D24). Consent is needed only when a profile outside
 * the caller's team would be absorbed: keeping the other rescuer's profile
 * folds the caller's into it straight away and notifies them — flag or
 * detected alike (D41); keeping the caller's asks the other owner. A profile
 * with no real owner can't be kept (D42): the adopter would sit on nobody's
 * list. Without `keepId` the rules above apply unchanged.
 */

export interface DedupSide {
    id: string;
    addedBy: string | null;
    createdAt: number | null; // epoch ms
    deleted: boolean;
    /** The caller created this record or shares a team with whoever did. */
    teamOwned: boolean;
}

export type DedupRefusal = 'unauthenticated' | 'not_found' | 'not_yours' | 'other_owner' | 'flag_cross_owner' | 'keep_not_allowed';

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
 * Merge directly or ask?
 *
 * With `keepId` (the side the rescuer chose to keep, D24): both sides
 * team-owned → merge; the absorbed side outside the team → ask its owner
 * (`ownerEmail` null = the admins, D15); the kept side outside the team →
 * merge and notify its owner, or refuse when it has no real owner (D42).
 *
 * Without `keepId` (today's callers): the older record survives. The viewer
 * merges straight away only when the absorbed (newer) side is team-owned and,
 * for a hand-filed flag, only when BOTH sides are; otherwise the owner of the
 * foreign side is asked (request).
 */
export function decideDedupAction(
    actor: string | null | undefined,
    a: DedupSide | null | undefined,
    b: DedupSide | null | undefined,
    source: 'detected' | 'flag' = 'detected',
    keepId?: string,
): DedupAction {
    if (!actor) return { kind: 'refuse', reason: 'unauthenticated' };
    if (!a || !b || a.deleted || b.deleted || a.id === b.id) return { kind: 'refuse', reason: 'not_found' };
    const created = (s: DedupSide) => !!s.addedBy && s.addedBy === actor;
    if (!created(a) && !created(b)) return { kind: 'refuse', reason: 'not_yours' };
    if (keepId !== undefined) {
        if (keepId !== a.id && keepId !== b.id) return { kind: 'refuse', reason: 'not_found' };
        const keep = keepId === a.id ? a : b;
        const absorbed = keep === a ? b : a;
        const chosen = { primaryId: keep.id, secondaryId: absorbed.id };
        if (!absorbed.teamOwned) return { kind: 'request', ...chosen, ownerEmail: realOwner(absorbed.addedBy) };
        if (keep.teamOwned) return { kind: 'merge', ...chosen, notifyOwner: null };
        const owner = realOwner(keep.addedBy);
        return owner ? { kind: 'merge', ...chosen, notifyOwner: owner } : { kind: 'refuse', reason: 'keep_not_allowed' };
    }
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

/** Which sides the viewer may choose to keep (the «¿Cuál queda?» switch, D42). */
export function keepOptions(
    actor: string | null | undefined,
    a: DedupSide | null | undefined,
    b: DedupSide | null | undefined,
): { a: boolean; b: boolean } {
    // With a chosen side the rule is the same for detected pairs and flags (D41).
    const allowed = (side: DedupSide | null | undefined) =>
        !!side && decideDedupAction(actor, a, b, 'detected', side.id).kind !== 'refuse';
    return { a: allowed(a), b: allowed(b) };
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

/** Order-independent key of an adopter pair (`a|b`, ids sorted). */
export function pairKey(aId: string, bId: string): string {
    return aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
}

export type MergeRequestStatus =
    | 'pending' | 'accepted' | 'declined' | 'cancelled' | 'admin_approved' | 'admin_declined' | 'closed';

export type MergeRequestAnswer =
    /** `swap`: merge the other way round — the request's secondary survives (a flip). */
    | { ok: true; nextStatus: MergeRequestStatus; merges: boolean; swap?: boolean }
    | { ok: false; reason: 'not_allowed' | 'not_open' };

/**
 * Who may accept / decline / cancel / flip a merge request, and what status
 * results. `flip` («Conservar el mío», D26): the asked owner keeps their own
 * profile and the requester's folds into it. After a decline the owner team
 * may still change its mind and accept (D43); an admin may approve.
 */
export function decideMergeRequestAnswer(input: {
    status: MergeRequestStatus;
    actorIsRequester: boolean;
    actorOnOwnerTeam: boolean;
    actorIsAdmin: boolean;
    decision: 'accept' | 'decline' | 'cancel' | 'flip';
}): MergeRequestAnswer {
    const { status, actorIsRequester, actorOnOwnerTeam, actorIsAdmin, decision } = input;
    const next = (nextStatus: MergeRequestStatus, merges = false): MergeRequestAnswer => ({ ok: true, nextStatus, merges });
    const flipped: MergeRequestAnswer = { ok: true, nextStatus: 'accepted', merges: true, swap: true };
    const notAllowed: MergeRequestAnswer = { ok: false, reason: 'not_allowed' };
    const notOpen: MergeRequestAnswer = { ok: false, reason: 'not_open' };
    const asOwner = actorOnOwnerTeam && !actorIsRequester;

    if (status !== 'pending' && status !== 'declined') return notOpen;
    if (status === 'declined') {
        // Only an accept reopens it: the owner team changing its mind, or an admin.
        if (decision !== 'accept') return notOpen;
        if (asOwner) return next('accepted', true);
        return actorIsAdmin ? next('admin_approved', true) : notOpen;
    }
    // status === 'pending'
    if (decision === 'cancel') return actorIsRequester ? next('cancelled') : notAllowed;
    if (decision === 'flip') {
        if (asOwner) return flipped;
        if (actorIsAdmin) return { ok: true, nextStatus: 'admin_approved', merges: true, swap: true };
        return notAllowed;
    }
    if (asOwner) return decision === 'accept' ? next('accepted', true) : next('declined');
    if (actorIsAdmin) return decision === 'accept' ? next('admin_approved', true) : next('admin_declined');
    return notAllowed;
}

/**
 * May this rescuer ask about the pair again? Not after the owner declined
 * their own request (D43) — they can still keep the other's profile, which
 * needs no consent, or write to them. Someone else's decline doesn't count.
 */
export function canRequestAgain(
    previous: Array<{ requesterEmail: string; status: MergeRequestStatus }>,
    requester: string,
): boolean {
    const norm = (e: string) => e.trim().toLowerCase();
    return !previous.some(r => r.status === 'declined' && norm(r.requesterEmail) === norm(requester));
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
