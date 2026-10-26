/**
 * Which household controls a viewer gets on a profile (spec
 * 2026-10-25-pendientes-d, D54). Mirrors the server gates in
 * `app/actions/householdMembers.ts`, which stay the authority — this only
 * decides what to show.
 *
 * - Add a member, or a contact to any member: anyone signed in.
 * - Edit a member: privileged (owner ∨ admin ∨ moderator ∨ org-mate of the
 *   owner), or the viewer added it.
 * - Remove a member: as edit, and for a non-privileged viewer every contact on
 *   it must be theirs too (removing it would remove someone else's data).
 * - Edit / remove a member's contact: privileged, or the viewer added it.
 *
 * "The viewer added it" is the per-viewer `own: true` view marker set by
 * `getAdopter` (never stored). Never compare `addedBy` with the session email:
 * a masked entry is rebuilt without `addedBy` or `id`.
 *
 * Structural types only, so this stays free of lib/ and server imports.
 */

/** The refusal every household action returns for a write the actor may not make. */
export const HOUSEHOLD_NOT_AUTHORIZED = 'Not authorized to edit this household.';

export interface HouseholdViewer {
    signedIn: boolean;
    /** owner ∨ admin ∨ moderator ∨ org-mate of the owner. */
    privileged: boolean;
}

interface Owned { own?: boolean }
interface ContactLike extends Owned { id?: string; masked?: boolean }
interface MemberLike extends Owned { contactEntries: ContactLike[] }

export function canAddToHousehold(viewer: HouseholdViewer): boolean {
    return viewer.signedIn;
}

export function canEditHouseholdMember(viewer: HouseholdViewer, member: MemberLike): boolean {
    if (!viewer.signedIn) return false;
    return viewer.privileged || member.own === true;
}

export function canRemoveHouseholdMember(viewer: HouseholdViewer, member: MemberLike): boolean {
    if (!viewer.signedIn) return false;
    if (viewer.privileged) return true;
    return member.own === true && member.contactEntries.every(e => e.own === true);
}

/** Edit / remove one contact on a member. A masked or id-less entry has nothing to anchor a change to. */
export function canChangeMemberContact(viewer: HouseholdViewer, entry: ContactLike): boolean {
    if (!viewer.signedIn || entry.masked || !entry.id) return false;
    return viewer.privileged || entry.own === true;
}

/**
 * After a contact this viewer added to a member is saved: whether to say
 * «Solicitamos acceso…». The household actions return no `autoRequestFiled`
 * (frozen shapes), and they file the request for every non-privileged contact
 * add, so it follows from the viewer. A bare member files none — callers show
 * this only after a contact.
 */
export function showsAccessRequestHint(viewer: HouseholdViewer): boolean {
    return viewer.signedIn && !viewer.privileged;
}
