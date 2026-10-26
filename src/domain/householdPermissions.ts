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

/**
 * D55 stored once: a member linked to their own profile (`profileId`) takes new
 * contacts on THAT profile (addContactEntry), never a copy on the host's
 * household row. The UI routes there; the server refuses a direct add.
 */
export const HOUSEHOLD_MEMBER_HAS_PROFILE = 'This member has their own profile: add the contact there.';

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
 * The household as a stranger would get it: no `own` markers. For «Ver como
 * desconocido» — a stranger added nothing, so the owner's own members must not
 * keep their edit/remove controls in the preview.
 */
export function withoutOwnMarks<E extends Owned, M extends Owned & { contactEntries: E[] }>(members: M[]): M[] {
    return members.map(m => {
        const { own: _own, ...rest } = m;
        return { ...rest, contactEntries: m.contactEntries.map(e => { const { own: _e, ...entry } = e; return entry as E; }) } as M;
    });
}

/**
 * What a failed household write tells the person (final review M6):
 * - `conflict`: a teammate changed or removed the item meanwhile (warning).
 * - `busy`: the save lost the race twice; the server's errorId is shown.
 * - `refused`: HOUSEHOLD_NOT_AUTHORIZED — expected, not a failure: not theirs
 *   to change, or it was theirs and the owner changed it meanwhile. A
 *   localized notice and a refresh; never a tracked error.
 * - `failed`: anything else — a real failure, shown with an errorId (the
 *   server's, or one the client files).
 */
export type HouseholdFailure =
    | { kind: 'conflict'; conflict: { kind: 'changed' | 'deleted'; by: string } }
    | { kind: 'busy'; errorId?: string }
    | { kind: 'refused' }
    | { kind: 'failed'; error: string; errorId?: string };

export function householdFailure(res: { error?: string; conflict?: { kind: 'changed' | 'deleted'; by: string }; errorId?: string }): HouseholdFailure {
    if (res.error === 'conflict' && res.conflict) return { kind: 'conflict', conflict: res.conflict };
    if (res.error === 'busy') return { kind: 'busy', errorId: res.errorId };
    if (res.error === HOUSEHOLD_NOT_AUTHORIZED) return { kind: 'refused' };
    return { kind: 'failed', error: res.error ?? 'unknown', errorId: res.errorId };
}
