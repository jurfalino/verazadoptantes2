/**
 * Pure resolver for the visibility badge shown on the adopter profile header and
 * the search-result card. Both surfaces call this so they can never disagree
 * (the card is a mirror of the profile). No DB / server imports — domain layer.
 *
 * States:
 *   'public'             — record is anonymously visible; contact is in the open.
 *   'protected-unlocked' — gating on and the viewer has FULL access
 *                          (owner / org-mate / admin / moderator, or an approved
 *                          all-contact grant).
 *   'protected-locked'   — gating on and the viewer does NOT have full access.
 *                          This covers every non-full-access view of a protected
 *                          record: a stranger who sees nothing, a viewer who only
 *                          unlocked specific fields via search/verify, AND a
 *                          record with no maskable contact left. A partial unlock
 *                          is not full access, so it stays "Protegido".
 *   null                 — NOT a protected-record view: the new-record form (no
 *                          record yet), or any record while PII gating is OFF
 *                          (the public/protected concept doesn't exist then).
 *
 * Every protected record under gating yields a badge — there is no "protected
 * but no badge" state.
 */
export type VisibilityBadge = 'public' | 'protected-locked' | 'protected-unlocked';

export interface VisibilityBadgeInput {
    isNew?: boolean;
    isPublic?: boolean | null;
    /** ENABLE_PII_ACCESS_GATING — from the viewer's PII context. */
    gatingOn?: boolean;
    /** The viewer has FULL contact access — `piiContext.hasFullAccess`
     *  (= visibility.nothingMasked: privileged, or an approved all-contact grant).
     *  A POSITIVE access signal — the ONLY thing that drives the green "unlocked"
     *  badge. Anything short of full access (no access, or a partial search/verify
     *  unlock) is "Protegido". */
    hasFullAccess?: boolean;
}

export function computeVisibilityBadge(input: VisibilityBadgeInput): VisibilityBadge | null {
    if (input.isNew) return null;
    if (input.isPublic) return 'public';
    // Non-public + gating off: no "protected" concept — no badge (today's behavior).
    if (!input.gatingOn) return null;
    // Green ONLY on a positive full-access signal — never inferred from `!masked`,
    // because a partial search/verify unlock (or a fieldless record) also leaves
    // nothing masked, and that must NOT read as "you have access".
    if (input.hasFullAccess) return 'protected-unlocked';
    // Every other view of a protected record is gray "Protegido": a stranger with
    // no access, a viewer who only unlocked specific fields via search/verify, or
    // a record with no maskable contact left. A partial unlock is not full access,
    // and a protected record is protected regardless of what's currently visible —
    // so no protected record ever falls through to "no badge".
    return 'protected-locked';
}
