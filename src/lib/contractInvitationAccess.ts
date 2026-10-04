/**
 * Contract invitations — the DB side of the access decision (pure rules in
 * contractInvitation.ts). A plain server module, NOT `'use server'`: it must
 * never become a browser-callable action.
 *
 * One decision, used at the three points of an invitation's life: issuing it
 * (createContractInvitation), opening it (GET /api/contract/by-token — no
 * login), and signing it (POST /api/contract/[id]/submit with a token). All
 * three resolve it for the INVITING rescuer (`contract_invitations.created_by`).
 */

import { formSubmissions } from '@/db/schema';
import { and, eq, or } from 'drizzle-orm';
import type { getDb } from '@/lib/db';
import { isPiiGatingEnabled, resolveAdopterVisibility, buildMaskOptions } from '@/lib/piiAccessServer';
import type { Visibility, MaskContactOptions } from '@/lib/piiAccess';
import { decideInvitationAccess, type InvitationAccessDecision } from '@/lib/contractInvitation';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export interface InvitationAccess extends InvitationAccessDecision {
    via: 'applicant' | 'full_access' | null;
    visibility: Visibility;
    maskOptions: MaskContactOptions;
    /** Email / phone the adopter typed in their form(s) for this animal. */
    submitted: string[];
}

/**
 * Resolve whether `rescuerEmail` may invite `adopter` to sign for `animalId`.
 *
 * "Applicant" uses the applicants panel's own predicate (getApplicantsForAnimal):
 * a form submission with `selected_animal_id = animalId` received by this
 * rescuer (`user_id`), linked to the adopter — `linked_adopter_id` (which «Es
 * la misma persona» re-points to the chosen profile) or `auto_adopter_id`.
 * Throws on a DB error; callers fail closed.
 */
export async function resolveInvitationAccess(
    db: Db,
    rescuerEmail: string,
    animalId: string,
    adopter: { id: string; addedBy: string | null; isPublic: number | boolean | null },
): Promise<InvitationAccess> {
    const [submissions, gatingOn, visibility, maskOptions] = await Promise.all([
        db.select({ email: formSubmissions.email, phone: formSubmissions.phone })
            .from(formSubmissions)
            .where(and(
                eq(formSubmissions.selectedAnimalId, animalId),
                eq(formSubmissions.userId, rescuerEmail),
                or(eq(formSubmissions.linkedAdopterId, adopter.id), eq(formSubmissions.autoAdopterId, adopter.id)),
            ))
            .all() as Promise<Array<{ email: string | null; phone: string | null }>>,
        isPiiGatingEnabled(),
        resolveAdopterVisibility(rescuerEmail, { id: adopter.id, addedBy: adopter.addedBy }),
        buildMaskOptions(adopter),
    ]);
    const isApplicant = submissions.length > 0;
    const decision = decideInvitationAccess({
        isApplicant,
        nothingMasked: visibility.nothingMasked,
        gatingOn,
        adopterIsPublic: !!maskOptions.adopterIsPublic,
    });
    const submitted = submissions.flatMap(s => [s.email, s.phone]).filter((v): v is string => !!v && !!v.trim());
    return {
        ...decision,
        via: !decision.allowed ? null : isApplicant ? 'applicant' : 'full_access',
        visibility,
        maskOptions,
        submitted,
    };
}
