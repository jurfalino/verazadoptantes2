/**
 * Bell titles for a new adoption-form submission (written by
 * /api/form/[userId]/submit). Notification titles are stored strings in
 * Spanish, like every other notification — not i18n keys.
 */

export interface FormSubmissionTitleInput {
    submitterName: string;
    /** The animal picked on the public showcase, when the form targeted one. */
    animalName: string | null;
    /** Possible duplicate records found for the submitter. */
    matchCount: number;
}

/** The form-link owner's title: «Juana aplicó para Luna — 2 coincidencias». */
export function formSubmissionOwnerTitle({ submitterName, animalName, matchCount }: FormSubmissionTitleInput): string {
    const prefix = animalName?.trim()
        ? `${submitterName} aplicó para ${animalName}`
        : `${submitterName} completó el formulario`;
    return matchCount > 0
        ? `${prefix} — ${matchCount} coincidencia${matchCount > 1 ? 's' : ''}`
        : prefix;
}

/**
 * The title the form-link owner's org-mates get. With an animal it is the
 * owner's title word for word — the team sees the same applicants (and the
 * same matches) on that animal. Without one it stays generic.
 */
export function formSubmissionTeammateTitle(input: FormSubmissionTitleInput): string {
    return input.animalName?.trim()
        ? formSubmissionOwnerTitle(input)
        : 'Nueva respuesta al formulario';
}
