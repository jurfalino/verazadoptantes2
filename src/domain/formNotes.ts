/**
 * The form answers listed in the notes of a profile created from a form
 * submission (getFormSubmissionPrefill). Pure.
 */

/** Already shown elsewhere on the profile (identity, contact, location) or not text. */
const SKIP = ['selfie', 'name', 'email', 'phone', 'address', 'latitude', 'longitude'];
const MAX_LINES = 15;

/** `key: value` lines; a free-text answer (`{ open }`) shows as the applicant wrote it. */
export function answerNoteLines(answers: Record<string, unknown>): string[] {
    const lines: string[] = [];
    for (const k of Object.keys(answers).filter(k => !SKIP.includes(k)).slice(0, MAX_LINES)) {
        const v = answers[k];
        if (v == null || v === '') continue;
        if (typeof v !== 'object') lines.push(`${k}: ${String(v)}`);
        else if (!Array.isArray(v)) {
            const open = (v as { open?: unknown }).open;
            lines.push(`${k}: ${typeof open === 'string' ? open : JSON.stringify(v)}`);
        }
    }
    return lines;
}
