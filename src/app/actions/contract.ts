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

import { logger } from '@/lib/logger';
import { auth } from '@/auth';
import { getDb } from './_db';

export interface CreateInvitationResult {
    success: boolean;
    token?: string;
    url?: string;
    error?: string;
}

/** Days a token stays valid. */
const INVITATION_TTL_DAYS = 30;

export async function createContractInvitation(
    animalId: string,
    adopterId: string,
): Promise<CreateInvitationResult> {
    try {
        const session = await auth();
        const userEmail = session?.user?.email;
        if (!userEmail) return { success: false, error: 'Unauthorized' };

        const db = await getDb();
        if (!db) return { success: false, error: 'Database not available' };

        const { adoptions, adopters, contractInvitations } = await import('@/db/schema');
        const { eq, and, isNull } = await import('drizzle-orm');

        // Authorize: caller must be the rescuer who added the animal.
        const animal = await db.select({
            id: adoptions.id,
            addedBy: adoptions.addedBy,
            adopterId: adoptions.adopterId,
        }).from(adoptions).where(eq(adoptions.id, animalId)).get();
        if (!animal) return { success: false, error: 'Animal not found' };
        if (animal.addedBy !== userEmail) return { success: false, error: 'Not authorized for this animal' };
        if (animal.adopterId) return { success: false, error: 'Animal already adopted' };

        // Confirm the adopter exists and is not soft-deleted.
        const adopter = await db.select({ id: adopters.id, deletedAt: adopters.deletedAt })
            .from(adopters)
            .where(eq(adopters.id, adopterId))
            .get();
        if (!adopter) return { success: false, error: 'Adopter not found' };
        if (adopter.deletedAt) return { success: false, error: 'Adopter record was deleted' };

        // Retire any prior unused invitations for this animal so only the
        // newest token is honored. We set expires_at to now() rather than
        // deleting so an audit trail survives.
        const now = Math.floor(Date.now() / 1000);
        await db.update(contractInvitations)
            .set({ expiresAt: now })
            .where(and(
                eq(contractInvitations.animalId, animalId),
                isNull(contractInvitations.usedAt),
            ));

        const token = crypto.randomUUID();
        const expiresAt = now + INVITATION_TTL_DAYS * 24 * 3600;

        await db.insert(contractInvitations).values({
            token,
            animalId,
            adopterId,
            createdBy: userEmail,
            createdAt: now,
            usedAt: null,
            expiresAt,
        });

        const { getContractBaseUrl } = await import('@/lib/contractUrl');
        const base = (await getContractBaseUrl()).replace(/\/+$/, '');
        const url = `${base}/c/${token}`;

        logger.info('Contract invitation created', { animalId, adopterId, createdBy: userEmail });
        return { success: true, token, url };
    } catch (e) {
        const errorId = logger.error('createContractInvitation failed', e, { animalId, adopterId });
        return { success: false, error: `Failed to create invitation (${errorId})` };
    }
}
