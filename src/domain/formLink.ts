/**
 * Which adopter profile a submitted adoption form belongs to, and what the
 * rescuer can still do about it.
 *
 * Every form submission auto-creates a profile for the applicant and links the
 * form to it (`/api/form/[userId]/submit`), so `linked_adopter_id` is set from
 * the first second and cannot by itself say whether the rescuer has decided
 * anything. Before v2.56.129 the page read it that way: it showed "linked"
 * before the rescuer acted, and identically after they chose an existing
 * profile — the only change was where "Ver perfil" pointed.
 * `auto_adopter_id` records which profile the form created, so comparing the
 * two does say it.
 *
 * Choosing an existing profile ("Es la misma persona") folds the auto-created
 * profile into it, the outcome contracts get from
 * attachContractToExistingAdopter — instead of leaving a duplicate behind.
 */

export type FormLinkKind = 'unlinked' | 'new_profile' | 'linked_existing';

export interface FormLinkRow {
    linkedAdopterId: string | null;
    autoAdopterId: string | null;
}

export function formLinkKind(row: FormLinkRow): FormLinkKind {
    if (!row.linkedAdopterId) return 'unlinked';
    return row.linkedAdopterId === row.autoAdopterId ? 'new_profile' : 'linked_existing';
}

/** The page's next steps. Banner, bottom actions and mobile bar render the same pair. */
export type FormResultsAction = 'review_matches' | 'view_profile' | 'create_profile';

export type FormResultsBanner =
    | 'review_matches'        // new profile created, look-alikes need a decision
    | 'new_profile'           // new profile created, nothing to decide
    | 'linked_existing'       // rescuer chose an existing profile
    | 'unlinked_with_matches' // no profile (auto-create failed), look-alikes exist
    | 'unlinked';             // no profile, nothing matched

export interface FormResultsView {
    banner: FormResultsBanner;
    primary: FormResultsAction;
    secondary: FormResultsAction | null;
    /** Whether match cards offer "Es la misma persona". */
    canLinkMatches: boolean;
    matchesOpenByDefault: boolean;
}

/** `visibleMatchCount` = matches still live and not dismissed with "No es esta persona". */
export function formResultsView(kind: FormLinkKind, visibleMatchCount: number): FormResultsView {
    const hasMatches = visibleMatchCount > 0;
    switch (kind) {
        case 'linked_existing':
            return { banner: 'linked_existing', primary: 'view_profile', secondary: null, canLinkMatches: false, matchesOpenByDefault: false };
        case 'new_profile':
            return hasMatches
                ? { banner: 'review_matches', primary: 'review_matches', secondary: 'view_profile', canLinkMatches: true, matchesOpenByDefault: true }
                : { banner: 'new_profile', primary: 'view_profile', secondary: null, canLinkMatches: false, matchesOpenByDefault: false };
        case 'unlinked':
            return hasMatches
                ? { banner: 'unlinked_with_matches', primary: 'create_profile', secondary: 'review_matches', canLinkMatches: true, matchesOpenByDefault: true }
                : { banner: 'unlinked', primary: 'create_profile', secondary: null, canLinkMatches: false, matchesOpenByDefault: false };
    }
}

export type FormLinkPlan =
    | { ok: true; op: 'noop' }
    | { ok: true; op: 'link' }
    | { ok: true; op: 'merge'; orphanId: string }
    | { ok: false; reason: 'not_a_match' | 'self' | 'target_unavailable' | 'already_linked' };

/**
 * What linking the form to `targetId` should do. Pure, so every refusal is
 * unit-tested; linkFormToExistingAdopter only fetches the inputs and executes.
 */
export function planFormLink(input: {
    row: FormLinkRow;
    targetId: string;
    /** Match ids recorded for this submission at submit time. */
    recordedMatchIds: readonly string[];
    targetLive: boolean;
    /** The auto-created profile still exists (was not merged away elsewhere). */
    autoLive: boolean;
}): FormLinkPlan {
    const { row, targetId } = input;
    // Before the match check: a retry must succeed even if matches changed since.
    if (row.linkedAdopterId === targetId) return { ok: true, op: 'noop' };
    if (targetId === row.autoAdopterId) return { ok: false, reason: 'self' };
    if (!input.recordedMatchIds.includes(targetId)) return { ok: false, reason: 'not_a_match' };
    if (!input.targetLive) return { ok: false, reason: 'target_unavailable' };

    switch (formLinkKind(row)) {
        case 'linked_existing':
            return { ok: false, reason: 'already_linked' };
        case 'new_profile':
            return input.autoLive && row.autoAdopterId
                ? { ok: true, op: 'merge', orphanId: row.autoAdopterId }
                : { ok: true, op: 'link' };
        case 'unlinked':
            return { ok: true, op: 'link' };
    }
}

/** One form as /my-adopters sees it. `submittedAt` is epoch seconds. */
export interface AdopterFormRow {
    id: string;
    /** The rescuer who shared the form — the only one who can act on it. */
    userId: string;
    linkedAdopterId: string | null;
    autoAdopterId: string | null;
    submittedAt: number;
    selectedAnimalId: string | null;
}

export interface AdopterFormSummary {
    count: number;
    latest: { submissionId: string; submittedAt: number; animalId: string | null; ownedByViewer: boolean } | null;
    /** One of the viewer's own forms is still waiting for "¿es la misma persona?". */
    needsReview: boolean;
}

/**
 * A person's forms, summarised for their /my-adopters row. "Needs review" is
 * the same rule the form-results page uses for its review banner
 * (formResultsView → 'review_matches'), so the list and the page can't
 * disagree. `liveMatchCount` = recorded matches whose profile still exists.
 */
export function summarizeAdopterForms(
    forms: readonly AdopterFormRow[],
    viewerEmail: string,
    liveMatchCount: (submissionId: string) => number,
): AdopterFormSummary {
    if (forms.length === 0) return { count: 0, latest: null, needsReview: false };
    const newest = forms.reduce((a, b) => (b.submittedAt > a.submittedAt ? b : a));
    const needsReview = forms.some(f =>
        f.userId === viewerEmail
        && formResultsView(formLinkKind(f), liveMatchCount(f.id)).banner === 'review_matches');
    return {
        count: forms.length,
        latest: {
            submissionId: newest.id,
            submittedAt: newest.submittedAt,
            animalId: newest.selectedAnimalId,
            ownedByViewer: newest.userId === viewerEmail,
        },
        needsReview,
    };
}
