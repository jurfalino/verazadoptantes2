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

/**
 * The card's order: the NEWER record is "the new submission", the older is
 * "the existing profile". Ties keep `a` as the new one (the same tie rule as
 * decideDedupAction's no-keepId path).
 */
export function orderPair<T extends Pick<DedupSide, 'createdAt'>>(a: T, b: T): { newer: T; older: T } {
    return (a.createdAt ?? 0) >= (b.createdAt ?? 0) ? { newer: a, older: b } : { newer: b, older: a };
}

export type KeepSide = 'new' | 'existing';
/**
 * What keeping a side does: 'merge' now, 'request' the other owner's consent,
 * or 'dispute' — ask the admins to review it (D49): the other owner already
 * rejected this viewer's request on the pair, so nobody merges one-sidedly.
 */
export type KeepAction = 'merge' | 'request' | 'dispute';

export interface PairChoices {
    /** Which side the viewer may keep («¿Cuál se conserva?»). */
    keepOptions: { new: boolean; existing: boolean };
    /** What keeping that side does: merge now, ask the other owner, ask the admins (D49), or null (not allowed). */
    actionByKeep: { new: KeepAction | null; existing: KeepAction | null };
    /** The survivor when the viewer chooses none: the older side if allowed, else the newer. */
    defaultKeep: KeepSide;
}

/**
 * Everything the «¿Cuál se conserva?» switch needs, decided once for the feed
 * (getPendingDuplicatesForUser) AND the click (mergePendingDedupPair), so the
 * row and the server can't disagree. On top of decideDedupAction with the
 * chosen side:
 * - Admins choose freely (D24): either side, merged straight away — unless
 *   the admin created neither side (`not_yours`), which nobody may merge here.
 * - A side with no real owner can't be kept by a rescuer (D42, `keep_not_allowed`).
 * - `declinedByViewer` (an owner declined a request on this pair by the
 *   viewer or a teammate: PairVerdict.declinedForTeam): a keep that would ask again is not allowed
 *   (D43), and keeping the other rescuer's profile — which would fold the
 *   viewer's into it with no consent — becomes a request to the admins,
 *   'dispute' (D49, revising D43): after «no es la misma persona» only the
 *   rescuer who declined (changing their mind) or an admin can merge.
 * - `adminRuledSeparate` (PairVerdict): an admin said they are two people, so
 *   any merge here becomes 'dispute' too — even on a pair re-flagged or
 *   rescanned later (mergeNeedsAdmins).
 * - `rebuilt` (the pair exists only as a merge request — no candidate or flag
 *   row for the click to load): nothing is allowed.
 */
export function pairChoices(
    viewer: string | null | undefined,
    a: DedupSide,
    b: DedupSide,
    source: 'detected' | 'flag',
    ctx: { isAdmin: boolean; declinedByViewer: boolean; adminRuledSeparate: boolean; rebuilt: boolean },
): PairChoices {
    const { newer, older } = orderPair(a, b);
    const actionFor = (keep: DedupSide): KeepAction | null => {
        if (ctx.rebuilt) return null;
        const d = decideDedupAction(viewer, a, b, source, keep.id);
        if (ctx.isAdmin) return d.kind !== 'refuse' || d.reason === 'keep_not_allowed' ? 'merge' : null;
        if (d.kind === 'refuse') return null;
        if (d.kind === 'request' && ctx.declinedByViewer) return null;
        const verdict = { declinedForTeam: ctx.declinedByViewer, adminRuledSeparate: ctx.adminRuledSeparate };
        if (d.kind === 'merge' && mergeNeedsAdmins(verdict, keep.teamOwned)) return 'dispute';
        return d.kind;
    };
    const actionByKeep = { new: actionFor(newer), existing: actionFor(older) };
    const keepOptions = { new: actionByKeep.new !== null, existing: actionByKeep.existing !== null };
    const defaultKeep: KeepSide = keepOptions.existing || !keepOptions.new ? 'existing' : 'new';
    return { keepOptions, actionByKeep, defaultKeep };
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
 * their own request (D43) — or a teammate's: pass the rescuer's whole team, so
 * the decline holds for the team (one shared reality). They can still ask the
 * admins (D49) or write to them. A decline of someone outside `requester` doesn't count.
 */
export function canRequestAgain(
    previous: Array<{ requesterEmail: string; status: MergeRequestStatus }>,
    requester: string | readonly string[],
): boolean {
    const norm = (e: string) => e.trim().toLowerCase();
    const who = new Set((typeof requester === 'string' ? [requester] : requester).map(norm));
    return !previous.some(r => r.status === 'declined' && who.has(norm(r.requesterEmail)));
}

/** 'closed': moot — the merge was undone elsewhere or its survivor merged away before an admin answered. */
export type MergeDisputeStatus = 'open' | 'kept' | 'undone' | 'closed';

/**
 * What has been said about a pair, for everyone (one shared reality):
 * - `declinedForTeam`: an owner rejected a request on the pair filed by the
 *   viewer or a teammate (D43);
 * - `adminRuledSeparate`: an admin ruled the two are different people — an
 *   admin-declined request, or a disputed merge an admin undid (D50).
 * Built from every request and dispute on the pair, either orientation.
 */
export interface PairVerdict {
    declinedForTeam: boolean;
    adminRuledSeparate: boolean;
}

export function pairVerdict(
    facts: {
        requests: Array<{ requesterEmail: string; status: MergeRequestStatus }>;
        disputes: Array<{ status: MergeDisputeStatus }>;
    },
    viewerTeam: readonly string[],
): PairVerdict {
    return {
        declinedForTeam: !canRequestAgain(facts.requests, viewerTeam),
        adminRuledSeparate: facts.requests.some(r => r.status === 'admin_declined') || facts.disputes.some(d => d.status === 'undone'),
    };
}

/**
 * THE rule every non-admin merge entry point applies before merging a pair
 * (the «Pendientes» feed and click via pairChoices, a contract or adoption
 * form folded into a matched profile): after an admin ruled the pair separate,
 * no rescuer merges it; after an owner rejected the team's request, keeping
 * the OTHER rescuer's profile (folding ours in without consent) doesn't
 * either. Either way the admins decide instead (D49, D50).
 */
export function mergeNeedsAdmins(verdict: PairVerdict, keepTeamOwned: boolean): boolean {
    return verdict.adminRuledSeparate || (verdict.declinedForTeam && !keepTeamOwned);
}

/**
 * May this viewer ask the admins to review a merge that already happened
 * («No es la misma persona», D50)? Only the owner team of either profile —
 * never the rescuer who merged, and never on a solo merge (every real owner of
 * both profiles is on the merging actor's team: nobody else's profile was
 * involved). Anyone else reads `not_found`, the same answer as a guessed id,
 * before anything about the merge's state. Then: an undone merge has nothing
 * left to dispute, and once an admin decided to keep it, that answer stands
 * for everyone (one shared reality).
 */
export function decideMergeDisputeRaise(input: {
    viewerIsActor: boolean;
    viewerOnSurvivorTeam: boolean;
    viewerOnAbsorbedTeam: boolean;
    soloMerge: boolean;
    undone: boolean;
    /**
     * The survivor was itself merged away (or removed) since: undoing this
     * merge alone is no longer possible, so a dispute would only be closed as
     * moot (answerMergeDispute). Refused up front instead.
     */
    superseded: boolean;
    /** An admin already resolved a dispute on this merge (kept). */
    decided: boolean;
}): { ok: true } | { ok: false; reason: 'not_found' | 'already_undone' | 'superseded' | 'already_decided' } {
    const eligible = !input.viewerIsActor && !input.soloMerge && (input.viewerOnSurvivorTeam || input.viewerOnAbsorbedTeam);
    if (!eligible) return { ok: false, reason: 'not_found' };
    if (input.undone) return { ok: false, reason: 'already_undone' };
    if (input.superseded) return { ok: false, reason: 'superseded' };
    if (input.decided) return { ok: false, reason: 'already_decided' };
    return { ok: true };
}

/** An admin resolves an open dispute (D50): «Deshacer combinación» → undone, «Mantener» → kept. */
export function decideMergeDisputeResolution(input: {
    status: MergeDisputeStatus;
    actorIsAdmin: boolean;
    decision: 'undo' | 'keep';
}): { ok: true; nextStatus: 'undone' | 'kept' } | { ok: false; reason: 'not_allowed' | 'not_open' } {
    if (!input.actorIsAdmin) return { ok: false, reason: 'not_allowed' };
    if (input.status !== 'open') return { ok: false, reason: 'not_open' };
    return { ok: true, nextStatus: input.decision === 'undo' ? 'undone' : 'kept' };
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
