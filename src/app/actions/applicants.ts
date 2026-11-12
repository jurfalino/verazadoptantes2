'use server';

/**
 * Per-animal applicant feed for the /my-animals card disclosure (v2.14.10-21).
 *
 * Surfaces `form_submissions` rows that targeted a specific animal (via the
 * `selected_animal_id` column populated when the form is launched from the
 * public showcase's "Quiero adoptarlo" CTA), joined to the auto-created
 * adopter row from Phase 1 (`linked_adopter_id`).
 *
 * v34: payload enriched with the signals needed by the in-place
 * <ApplicantDetailPanel> deep-dive surface — flags, activity counters,
 * form-summary fields (intent / species / lifeStage), full submission payload
 * for the panel's form section, and adopter-context for the profile section.
 * D1-safe per-applicant fan-out via Promise.all (no inArray).
 *
 * The query and enrichment live in `_applicants.ts` (not a server-action
 * module), so the only browser-callable export here stays this gated action.
 */

import { logger } from '@/lib/logger';
import { getDb } from './_db';
import { auth } from '@/auth';
import type { AdopterFlags } from '@/types/adopter';
import type { HousemateAlertSummary } from '@/domain/households';
import type { ApplicationOrigin } from '@/domain/constants';
import type { ApplicationStatus } from '@/domain/applications';
import type { ApplicantsLoad } from '@/lib/applicantsLoad';

export interface ApplicantSubmissionPayload {
    email: string | null;
    phone: string | null;
    address: string | null;
    selfieUrl: string | null;
    /** Form photos (release 2) as access-checked links — never storage keys. */
    photos: { protection: string[]; sleep: string | null };
    latitude: string | null;
    longitude: string | null;
    household: string[] | null;
    answersJson: string | null;
}

export interface ApplicantAdopterContext {
    addedBy: string | null;
    /** Rescuer's display name for `addedBy` (email handle when they have none). */
    addedByName: string | null;
    source: string | null;
    country: string | null;
}

export interface ApplicantSummary {
    /** The application (one per form and animal) — what the panel evaluates. */
    applicationId: string;
    origin: ApplicationOrigin;
    status: ApplicationStatus;
    /** The adopted animal a form asked for (origin adopted_animal); named only when it is the viewer's team's own. */
    askedAnimal: { id: string; name: string; sex: string | null } | null;
    /** The animal a general application led to — «Propuesta para …» (proposed) / «También pidió a …» (also_applied); named only when it is the viewer's team's own. */
    outcomeAnimal: { id: string; name: string; sex: string | null } | null;
    submissionId: string;
    adopterId: string | null;
    adopterName: string;
    adopterRating: number | null;
    appliedAt: number | null; // unix seconds
    /** True when this applicant has a LIVE contract link for this animal (status contract_sent). */
    hasInvite: boolean;
    /** True when this application is the adopted one (status adopted). */
    isSigned: boolean;
    // ── v34 enrichment ──────────────────────────────────────────────
    /** Same shape /my-adopters uses, so <FlagBadges> renders directly. Null for orphan submissions.
     *  Its period alerts are the ones read (none when that read failed — then `alertsChecked` is false). */
    flags: AdopterFlags | null;
    /** True only when the person's alerts (period + housemates) were actually read (P2):
     *  the panel says «Sin alertas en el perfil» only then. */
    alertsChecked: boolean;
    /** The profile is the one this form created and still sits on (formLinkKind 'new_profile'). */
    profileFromThisForm?: boolean;
    /** The housemate chips' answers («Conviviente con calificación N» / «con alertas»); none when that read failed. */
    housemateAlert: HousemateAlertSummary;
    adoptionCount: number;
    requestCount: number;
    /** Form-submission attribution signals for the row's 1-line summary. */
    intent: string | null;
    species: string | null;
    lifeStage: string | null;
    /** Full submission payload — fed to the panel's form section. */
    submission: ApplicantSubmissionPayload;
    /** Adopter metadata — fed to the panel's profile section. Null for orphan submissions. */
    adopterContext: ApplicantAdopterContext | null;
}

/**
 * Returns the form submissions targeted at `animalId` — every applicant who
 * came through a form link of the animal OWNER's team (owner + org-mates),
 * whichever member shared it (2026-09-30 product decision; before, each
 * viewer saw only their own link's applicants).
 *
 * Gate: the viewer must be the owner, an org-mate of the owner, or an admin
 * (same rule as `getAnimalProfile`). The scope is the OWNER's team, not the
 * viewer's, so every viewer of the animal sees the same list — and the
 * /my-animals card count uses the same scope (src/lib/applicantScope.ts).
 */
export async function getApplicantsForAnimal(animalId: string): Promise<ApplicantsLoad> {
    const none: ApplicantsLoad = { ok: true, applicants: [] };
    let userEmail: string | null | undefined;
    try {
        const session = await auth();
        userEmail = session?.user?.email;
        if (!userEmail) return none;

        const db = await getDb();
        if (!db) throw new Error('Database unavailable');

        const { adoptions } = await import('@/db/schema');
        const { eq } = await import('drizzle-orm');

        const animal = await db.select({ addedBy: adoptions.addedBy, adopterId: adoptions.adopterId })
            .from(adoptions)
            .where(eq(adoptions.id, animalId))
            .get();
        // Unknown, deleted or not the viewer's team's: nothing to list (never a hint it exists).
        if (!animal) return none;

        const { isOwnerOrgMateOrAdmin, loadApplicantsForAnimal } = await import('./_applicants');
        if (!(await isOwnerOrgMateOrAdmin(userEmail, animal.addedBy))) return none;

        const { getTeamEmails } = await import('@/lib/orgMembership');
        const teamEmails = await getTeamEmails(animal.addedBy);
        return { ok: true, applicants: await loadApplicantsForAnimal(db, { id: animalId, adopterId: animal.adopterId ?? null }, teamEmails, userEmail) };
    } catch (e) {
        // A failure is not «no applicants»: the panel shows it with this id (never closes silently).
        const errorId = logger.error('getApplicantsForAnimal failed', e, { animalId, userEmail });
        return { ok: false, errorId };
    }
}
