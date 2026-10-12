/**
 * Who may open a form submission — /form-results, the «Crear adoptante»
 * prefill and «Vincular». ONE rule for all three, and it agrees with the
 * animal page, which lists an animal's applicants to the animal OWNER's team.
 *
 * Allowed when any of:
 *   1. the viewer is the form-link owner (`user_id`) or an org-mate of theirs;
 *   2. the viewer is an admin (same as the animal page / getAnimalProfile);
 *   3. the submission targets an animal whose owner the viewer is (or is an
 *      org-mate of), AND the form-link owner is in that owner's team.
 *
 * Branch 3 covers an owner in two groups: O shares org1 with V and org2 with
 * T. V sees T's-link applicant on O's animal page, so V can open it here
 * too. The scope is the ANIMAL OWNER's team, never the viewer's — and the
 * form-link-owner check keeps forged `/form?u=<stranger>&animal=<ours>` rows
 * out, exactly like the list (src/lib/applicantScope.ts).
 *
 * Pure apart from the injected lookups, so the rule is unit-tested
 * (formSubmissionAccess.test.ts); `_applicants.ts` wires the real ones.
 */

import { normalizeTeamScope, isInTeamScope } from '@/lib/applicantScope';

export interface FormSubmissionRef {
    /** Form-link owner's email (`form_submissions.user_id`). */
    userId: string;
    selectedAnimalId: string | null;
}

export interface FormSubmissionAccessDeps {
    isOwnerOrOrgMate(viewer: string, owner: string): Promise<boolean>;
    isAdmin(viewer: string): Promise<boolean>;
    /** The animal's `addedBy`, or null when missing / deleted / ownerless. */
    getAnimalOwner(animalId: string): Promise<string | null>;
    getTeamEmails(owner: string): Promise<string[]>;
}

export async function canViewerAccessFormSubmission(
    viewerEmail: string | null | undefined,
    submission: FormSubmissionRef,
    deps: FormSubmissionAccessDeps,
): Promise<boolean> {
    const viewer = (viewerEmail ?? '').trim();
    if (!viewer) return false;

    // 1. The form-link owner's team.
    if (submission.userId && await deps.isOwnerOrOrgMate(viewer, submission.userId)) return true;

    // 2. Admin.
    if (await deps.isAdmin(viewer)) return true;

    // 3. The animal owner's team — only reached when 1 failed.
    if (!submission.selectedAnimalId) return false;
    const animalOwner = await deps.getAnimalOwner(submission.selectedAnimalId);
    if (!animalOwner) return false;
    if (!(await deps.isOwnerOrOrgMate(viewer, animalOwner))) return false;
    const scope = normalizeTeamScope(await deps.getTeamEmails(animalOwner));
    return isInTeamScope(submission.userId, scope);
}
