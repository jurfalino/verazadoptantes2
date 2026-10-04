/**
 * Email format accepted by the public adoption form — the SAME rule the form's
 * own client check applies (contract-app/src/PetShieldForm.tsx `VALIDATORS.email`,
 * run on the trimmed value), so a real applicant who got past the form is never
 * rejected by the server. Keep the two in sync.
 *
 * Defense in depth only: a well-formed email still lets someone submit a probe
 * form; what protects other rescuers' profiles is the match-card masking.
 */
const FORM_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidFormEmail(value: string | null | undefined): boolean {
    return FORM_EMAIL_RE.test((value ?? '').trim());
}
