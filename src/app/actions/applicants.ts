'use server';

/**
 * Per-animal applicant feed for the /my-animals card disclosure (v2.14.10-21).
 *
 * Surfaces `form_submissions` rows that targeted a specific animal (via the
 * `selected_animal_id` column populated when the form is launched from the
 * public showcase's "Quiero adoptarlo" CTA), joined to the auto-created
 * adopter row from Phase 1 (`linked_adopter_id`).
 *
 * The rescuer picks one applicant and the "Enviar contrato" action
 * (Phase 5) issues a per-adopter contract invitation token.
 */

import { logger } from '@/lib/logger';
import { getDb } from './_db';
import { auth } from '@/auth';
import { computeAvgRating } from '@/domain/ratings';

export interface ApplicantSummary {
    submissionId: string;
    adopterId: string | null;
    adopterName: string;
    adopterRating: number | null;
    appliedAt: number | null; // unix seconds
    /** True when this applicant already has a contract issued for this animal. */
    hasInvite: boolean;
    /** True when this applicant has already signed the contract for this animal. */
    isSigned: boolean;
}

/**
 * Returns the form submissions targeted at `animalId`, scoped to the
 * current user (must own the animal or share its org).
 *
 * D1-safe: per-row enrichment uses Promise.all with one `eq(id)` each
 * (per CLAUDE.md, no `inArray`).
 */
export async function getApplicantsForAnimal(animalId: string): Promise<ApplicantSummary[]> {
    try {
        const session = await auth();
        const userEmail = session?.user?.email;
        if (!userEmail) return [];

        const db = await getDb();
        if (!db) return [];

        const { formSubmissions, adopters, adoptions, contractInvitations } = await import('@/db/schema');
        const { eq, and, isNull } = await import('drizzle-orm');

        // Authorize: caller must be the rescuer who added the animal (org-wide
        // visibility is a v2 nice-to-have; keep scope tight for now).
        const animal = await db.select({ addedBy: adoptions.addedBy, adopterId: adoptions.adopterId })
            .from(adoptions)
            .where(eq(adoptions.id, animalId))
            .get();
        if (!animal || animal.addedBy !== userEmail) return [];

        const rows = await db.select({
            id: formSubmissions.id,
            name: formSubmissions.name,
            linkedAdopterId: formSubmissions.linkedAdopterId,
            createdAt: formSubmissions.createdAt,
        })
            .from(formSubmissions)
            .where(and(
                eq(formSubmissions.selectedAnimalId, animalId),
                eq(formSubmissions.userId, userEmail),
            ))
            .all() as Array<{ id: string; name: string; linkedAdopterId: string | null; createdAt: Date | null }>;

        if (rows.length === 0) return [];

        // Per-applicant enrichment. D1-safe — no inArray. The "rating" comes
        // from the linked adopter's average; absent for unlinked legacy rows.
        const enriched = await Promise.all(rows.map(async (row) => {
            let adopterName = row.name;
            let adopterRating: number | null = null;
            if (row.linkedAdopterId) {
                // adopter.status is the deprecated legacy rating field (frozen at "5"
                // for every record — see memory project-adopter-status-deprecated).
                // The real rating is computed from the adopter's activity records'
                // non-null `rating` values, via computeAvgRating.
                const [adopter, records] = await Promise.all([
                    db.select({ name: adopters.name })
                        .from(adopters)
                        .where(eq(adopters.id, row.linkedAdopterId))
                        .get(),
                    db.select({ rating: adoptions.rating })
                        .from(adoptions)
                        .where(eq(adoptions.adopterId, row.linkedAdopterId))
                        .all() as Promise<Array<{ rating: number | null }>>,
                ]);
                if (adopter) {
                    adopterName = adopter.name;
                    adopterRating = computeAvgRating(records);
                }
            }

            // Already signed? — the animal is adopted by this specific adopter.
            const isSigned = !!(animal.adopterId && row.linkedAdopterId && animal.adopterId === row.linkedAdopterId);

            // Outstanding invitation? — exists in contract_invitations for this animal+adopter
            // and has not been used yet.
            let hasInvite = false;
            if (row.linkedAdopterId && !isSigned) {
                const inv = await db.select({ token: contractInvitations.token })
                    .from(contractInvitations)
                    .where(and(
                        eq(contractInvitations.animalId, animalId),
                        eq(contractInvitations.adopterId, row.linkedAdopterId),
                        isNull(contractInvitations.usedAt),
                    ))
                    .get();
                hasInvite = !!inv;
            }

            return {
                submissionId: row.id,
                adopterId: row.linkedAdopterId,
                adopterName,
                adopterRating,
                appliedAt: row.createdAt ? Math.floor(row.createdAt.getTime() / 1000) : null,
                hasInvite,
                isSigned,
            };
        }));

        // Newest first.
        enriched.sort((a, b) => (b.appliedAt ?? 0) - (a.appliedAt ?? 0));
        return enriched;
    } catch (e) {
        logger.warn('getApplicantsForAnimal failed', {
            animalId,
            error: e instanceof Error ? e.message : String(e),
        });
        return [];
    }
}
