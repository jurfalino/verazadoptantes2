/**
 * Pure resolver for the visibility badge shown on the adopter profile header and
 * the search-result card. Both surfaces call this so they can never disagree
 * (the card is a mirror of the profile). No DB / server imports — domain layer.
 *
 * States:
 *   'public'             — record is anonymously visible; contact is in the open.
 *   'protected-locked'   — gating on and the viewer's contact view is masked
 *                          (stranger, or a partial search-unlock).
 *   'protected-unlocked' — gating on and the viewer has full access
 *                          (owner / org-mate / admin / moderator, or an approved
 *                          all-contact grant). This is the state that used to
 *                          render no badge at all.
 *   null                 — no badge: the new-record form, or a non-public record
 *                          while PII gating is OFF (there is no "protected"
 *                          concept then — same as today's behavior).
 */
export type VisibilityBadge = 'public' | 'protected-locked' | 'protected-unlocked';

export interface VisibilityBadgeInput {
    isNew?: boolean;
    isPublic?: boolean | null;
    /** ENABLE_PII_ACCESS_GATING — from the viewer's PII context. */
    gatingOn?: boolean;
    /** The viewer has FULL contact access — `piiContext.hasFullAccess`
     *  (= visibility.nothingMasked: privileged, or an approved all-contact grant).
     *  A POSITIVE access signal — drives the green "unlocked" badge. */
    hasFullAccess?: boolean;
    /** The viewer's contact view is masked (gating on, not full access, ≥1
     *  maskable field exists) — `piiContext.masked`. Drives the "locked" badge. */
    masked?: boolean;
}

export function computeVisibilityBadge(input: VisibilityBadgeInput): VisibilityBadge | null {
    if (input.isNew) return null;
    if (input.isPublic) return 'public';
    // Non-public + gating off: no "protected" concept — no badge (today's behavior).
    if (!input.gatingOn) return null;
    // Green ONLY on a positive full-access signal — never inferred from `!masked`,
    // because a record with zero maskable fields also has masked=false for a
    // stranger (which must NOT read as "you have access").
    if (input.hasFullAccess) return 'protected-unlocked';
    // Masked ⇒ there IS protected contact the viewer can't see → locked badge.
    if (input.masked) return 'protected-locked';
    // Non-public, gating on, no access, nothing maskable (fieldless / legacy
    // blob-only): show no badge — same as before this feature.
    return null;
}
