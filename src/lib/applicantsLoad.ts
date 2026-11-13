/**
 * What the applicant panel's loaders answer (getApplicantsForAnimal, getGeneralApplications): the list —
 * empty for a refusal (signed out, not the team's animal) — or a FAILURE carrying the errorId it was logged
 * under, so the panel says so instead of reading an outage as «everything was decided» (final review M7).
 * Pure; safe on the client.
 */
import type { ApplicantSummary } from '@/app/actions/applicants';

export type ApplicantsLoad = { ok: true; applicants: ApplicantSummary[] } | { ok: false; errorId: string };

/** The list, or a throw whose message carries the errorId (`resolveErrorId` / `extractErrorId` reuse it). */
export function applicantsOrThrow(res: ApplicantsLoad, source: string): ApplicantSummary[] {
    if (res.ok) return res.applicants;
    throw new Error(`${source} failed (Error ID: ${res.errorId})`);
}
