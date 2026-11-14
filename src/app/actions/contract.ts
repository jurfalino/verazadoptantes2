'use server';

/**
 * Contract invitation factory (v2.14.10-21 / Phase 5).
 *
 * Issues a per-adopter contract token so the contract URL is locked to one
 * specific person instead of being open-link-whoever-signs-first. Used by the
 * "Enviar contrato" button in the per-animal applicants disclosure on
 * /my-animals.
 *
 * Multi-token semantics: **one outstanding invitation per animal**. Issuing
 * a new token retires any prior unused invitation for the same animal
 * (sets expires_at = now()). Several tokens per applicant across animals is
 * fine; the constraint is per-animal.
 *
 * Legacy /contract/<animalId> open links continue to work unchanged — they
 * route through the existing /api/contract/[id]/submit path and create a
 * brand-new adopter (Phase 1 sets source='contract' on those). The new
 * locked flow lives at /c/<token> in the contract-app.
 */

import { logger, generateErrorId } from '@/lib/logger';
import { auth } from '@/auth';
import { getDb } from './_db';
import { INVITATION_TTL_DAYS } from '@/domain/constants';
import { takesContract } from '@/domain/placements';

export interface CreateInvitationResult {
    success: boolean;
    token?: string;
    url?: string;
    /** `'not_allowed'` when the adopter is neither an applicant for this animal
     *  nor a profile the caller fully sees; `'already_decided'` when the team turned
     *  them down for this animal and none of their applications is still open
     *  (a teammate's «No avanzar» while this panel was open); `'same_person_unanswered'` when a
     *  possible duplicate of the profile the form created still waits for «¿Es la misma persona?»;
     *  `'removed'` when the candidacy it was sent from no longer exists (a teammate's «Quitar»);
     *  otherwise a free-text failure. */
    error?: string;
    errorId?: string;
}

export async function createContractInvitation(
    animalId: string,
    adopterId: string,
    // The sharing rescuer's current UI language, captured client-side at share
    // time. Persisted so the contract-app renders the whole flow in it.
    locale?: string,
    /** The candidacy the panel sends it from: gone («Quitar» meanwhile) → `removed`, nothing written (review I1). */
    applicationId?: string,
): Promise<CreateInvitationResult> {
    try {
        const session = await auth();
        const userEmail = session?.user?.email;
        if (!userEmail) return { success: false, error: 'Unauthorized' };

        const db = await getDb();
        if (!db) return { success: false, error: 'Database not available' };

        const { adoptions, adopters, contractInvitations } = await import('@/db/schema');
        const { eq, and, isNull } = await import('drizzle-orm');

        // Authorize: the animal's owner, an org-mate of theirs, or an admin.
        const animal = await db.select({
            id: adoptions.id,
            addedBy: adoptions.addedBy,
            adopterId: adoptions.adopterId,
            recordType: adoptions.recordType,
        }).from(adoptions).where(eq(adoptions.id, animalId)).get();
        if (!animal) return { success: false, error: 'Animal not found' };
        // v2.55.18: org-mates get full parity on team animals. Admins too, like
        // the animal page and its applicants list — sending the contract is the
        // next step from that list.
        const { isOwnerOrgMateOrAdmin } = await import('./_applicants');
        if (!(await isOwnerOrgMateOrAdmin(userEmail, animal.addedBy))) return { success: false, error: 'Not authorized for this animal' };
        if (!takesContract(animal)) return { success: false, error: 'Animal already adopted' };

        // Sent from a candidacy that a teammate's «Quitar» removed since the panel read: the person is no longer
        // among this animal's candidates. Refused before anything is written (Jon 2026-11-13, review I1).
        if (applicationId !== undefined) {
            const { applications } = await import('@/db/schema');
            const still = typeof applicationId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(applicationId)
                ? await db.select({ id: applications.id }).from(applications)
                    .where(and(eq(applications.id, applicationId), eq(applications.animalId, animalId))).get()
                : undefined;
            if (!still) {
                logger.info('createContractInvitation: refused — the candidacy was removed', { animalId, adopterId, applicationId, createdBy: userEmail });
                return { success: false, error: 'removed' };
            }
        }

        // Confirm the adopter exists and is not soft-deleted.
        const adopter = await db.select({ id: adopters.id, deletedAt: adopters.deletedAt, addedBy: adopters.addedBy, isPublic: adopters.isPublic })
            .from(adopters)
            .where(eq(adopters.id, adopterId))
            .get();
        if (!adopter) return { success: false, error: 'Adopter not found' };
        if (adopter.deletedAt) return { success: false, error: 'Adopter record was deleted' };

        // Only someone who applied for THIS animal (the applicants panel's own
        // rows) or a profile the caller already fully sees. Without this, any
        // rescuer could invite another rescuer's adopter by id and read their
        // contact on the token page — and rewrite it by signing.
        const { resolveInvitationAccess } = await import('@/lib/contractInvitationAccess');
        const access = await resolveInvitationAccess(db, userEmail, animalId, adopter);
        if (!access.allowed) {
            const errorId = generateErrorId();
            logger.warn('createContractInvitation: refused — not an applicant and no full access', {
                animalId, adopterId, createdBy: userEmail, errorId,
            });
            return { success: false, error: 'not_allowed', errorId };
        }
        // An applicant the team turned down («No avanzar») for this animal, with no open application left, gets
        // no contract: the panel that offered the button was read before the decline. Refused BEFORE the
        // retirement below, so another applicant's live link survives. Candidates closed by an adoption stay
        // sendable (the animal may have come back), and a profile with no application keeps the full-access path.
        const { refusedAsDecided } = await import('@/lib/contractInvitationAccess');
        if (refusedAsDecided(access)) {
            logger.info('createContractInvitation: refused — the application already has an outcome', { animalId, adopterId, createdBy: userEmail });
            return { success: false, error: 'already_decided' };
        }
        // «¿Es la misma persona?» first (Jon 2026-11-12): a profile a form created gets no contract while a
        // possible duplicate the caller may answer has no answer («No sé» counts). The panel locks the button;
        // this refuses the list's button and a panel read before the lock changed. (A tab from an older build
        // is forwarded to its own deployment, which has no lock, until that build leaves the deploy map.)
        // Refused BEFORE the retirement below.
        try {
            const { unansweredForContract } = await import('@/lib/samePersonGate');
            const waiting = await unansweredForContract(db, animalId, adopterId, userEmail);
            if (waiting > 0) {
                logger.info('createContractInvitation: refused — «¿Es la misma persona?» unanswered', { animalId, adopterId, createdBy: userEmail, waiting });
                return { success: false, error: 'same_person_unanswered' };
            }
        } catch (e) {
            const errorId = logger.error('createContractInvitation: same-person check failed', e, { animalId, adopterId, createdBy: userEmail });
            return { success: false, error: 'failed', errorId };
        }

        // Retire any prior unused invitations for this animal so only the
        // newest token is honored. We set expires_at to now() rather than
        // deleting so an audit trail survives.
        const now = Math.floor(Date.now() / 1000);
        const token = crypto.randomUUID();
        const expiresAt = now + INVITATION_TTL_DAYS * 24 * 3600;
        const validLocale = locale === 'es' || locale === 'en' || locale === 'pt' ? locale : null;
        const retireOthers = and(eq(contractInvitations.animalId, animalId), isNull(contractInvitations.usedAt));

        if (applicationId !== undefined) {
            // Sent from a candidacy: retire + insert are ONE atomic step, and both happen only while the candidacy
            // still exists. A teammate's «Quitar» (one atomic step too, refused once a link exists) can't interleave:
            // whichever lands first wins, never both — and a lost race retires nobody's link (review I-1).
            const { applications } = await import('@/db/schema');
            const { sql } = await import('drizzle-orm');
            const { runBatch } = await import('@/lib/dbBatch');
            const candidacy = and(eq(applications.id, applicationId), eq(applications.animalId, animalId));
            await runBatch(db, [
                db.update(contractInvitations).set({ expiresAt: now })
                    .where(and(retireOthers, sql`EXISTS (SELECT 1 FROM applications WHERE id = ${applicationId} AND animal_id = ${animalId})`)),
                db.insert(contractInvitations).select(
                    db.select({
                        token: sql`${token}`.as('token'),
                        animalId: sql`${animalId}`.as('animal_id'),
                        adopterId: sql`${adopterId}`.as('adopter_id'),
                        createdBy: sql`${userEmail}`.as('created_by'),
                        createdAt: sql`${now}`.as('created_at'),
                        usedAt: sql`NULL`.as('used_at'),
                        expiresAt: sql`${expiresAt}`.as('expires_at'),
                        locale: sql`${validLocale}`.as('locale'),
                    }).from(applications).where(candidacy),
                ),
            ]);
            const saved = await db.select({ token: contractInvitations.token }).from(contractInvitations).where(eq(contractInvitations.token, token)).get();
            if (!saved) {
                logger.info('createContractInvitation: refused — the candidacy was removed while sending', { animalId, adopterId, applicationId, createdBy: userEmail });
                return { success: false, error: 'removed' };
            }
        } else {
            await db.update(contractInvitations)
                .set({ expiresAt: now })
                .where(retireOthers);

            await db.insert(contractInvitations).values({
                token,
                animalId,
                adopterId,
                createdBy: userEmail,
                createdAt: now,
                usedAt: null,
                expiresAt,
                locale: validLocale,
            });
        }

        const { getContractBaseUrl } = await import('@/lib/contractUrl');
        const base = (await getContractBaseUrl()).replace(/\/+$/, '');
        // Stamp ?lang= so the contract-app has the language immediately (before
        // its by-token fetch resolves); the persisted column is the backstop.
        const url = validLocale ? `${base}/c/${token}?lang=${validLocale}` : `${base}/c/${token}`;

        // A contract sent answers their application(s): the forms' bell notices read, for everyone (best-effort, logged).
        const { clearFormNotices } = await import('@/lib/formNotices');
        for (const submissionId of access.submissionIds) {
            await clearFormNotices(db, submissionId, { op: 'createContractInvitation', animalId, adopterId, createdBy: userEmail });
        }

        logger.info('Contract invitation created', { animalId, adopterId, createdBy: userEmail, via: access.via });
        return { success: true, token, url };
    } catch (e) {
        const errorId = logger.error('createContractInvitation failed', e, { animalId, adopterId });
        return { success: false, error: `Failed to create invitation (${errorId})`, errorId };
    }
}
