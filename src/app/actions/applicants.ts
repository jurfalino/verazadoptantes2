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
 */

import { logger } from '@/lib/logger';
import { getDb } from './_db';
import { auth } from '@/auth';
import { computeAvgRating } from '@/domain/ratings';
import { buildFlags } from '@/domain/flags';
import type { AdopterFlags } from '@/types/adopter';

export interface ApplicantSubmissionPayload {
    email: string | null;
    phone: string | null;
    address: string | null;
    selfieUrl: string | null;
    latitude: string | null;
    longitude: string | null;
    household: string[] | null;
    answersJson: string | null;
}

export interface ApplicantAdopterContext {
    addedBy: string | null;
    source: string | null;
    country: string | null;
}

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
    // ── v34 enrichment ──────────────────────────────────────────────
    /** Same shape /my-adopters uses, so <FlagBadges> renders directly. Null for orphan submissions. */
    flags: AdopterFlags | null;
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

        const { formSubmissions, adopters, adoptions, contractInvitations, adopterFlags } = await import('@/db/schema');
        const { eq, and, isNull } = await import('drizzle-orm');

        // Authorize: the rescuer who added the animal or any org-mate
        // (v2.55.18 — the long-promised org-wide visibility, full parity).
        const animal = await db.select({ addedBy: adoptions.addedBy, adopterId: adoptions.adopterId })
            .from(adoptions)
            .where(eq(adoptions.id, animalId))
            .get();
        if (!animal) return [];
        const { isOwnerOrOrgMate } = await import('@/lib/orgMembership');
        if (!(await isOwnerOrOrgMate(userEmail, animal.addedBy))) return [];

        const rows = await db.select({
            id: formSubmissions.id,
            name: formSubmissions.name,
            email: formSubmissions.email,
            phone: formSubmissions.phone,
            address: formSubmissions.address,
            selfieUrl: formSubmissions.selfieUrl,
            latitude: formSubmissions.latitude,
            longitude: formSubmissions.longitude,
            intent: formSubmissions.intent,
            species: formSubmissions.species,
            lifeStage: formSubmissions.lifeStage,
            household: formSubmissions.household,
            answersJson: formSubmissions.answersJson,
            linkedAdopterId: formSubmissions.linkedAdopterId,
            createdAt: formSubmissions.createdAt,
        })
            .from(formSubmissions)
            .where(and(
                eq(formSubmissions.selectedAnimalId, animalId),
                eq(formSubmissions.userId, userEmail),
            ))
            .all() as Array<{
                id: string; name: string;
                email: string | null; phone: string | null; address: string | null;
                selfieUrl: string | null; latitude: string | null; longitude: string | null;
                intent: string | null; species: string | null; lifeStage: string | null;
                household: string | null; answersJson: string | null;
                linkedAdopterId: string | null; createdAt: Date | null;
            }>;

        if (rows.length === 0) return [];

        const parseHousehold = (raw: string | null): string[] | null => {
            if (!raw) return null;
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed.filter((s): s is string => typeof s === 'string');
                return null;
            } catch {
                return null;
            }
        };

        // Per-applicant enrichment. D1-safe — no inArray. Each linked adopter
        // gets parallel lookups for name+context, activity records (for both
        // rating + counts), flag rows, and contract-invite state. Orphan
        // submissions (linkedAdopterId=null) get a zeroed shape.
        const enriched = await Promise.all(rows.map(async (row) => {
            let adopterName = row.name;
            let adopterRating: number | null = null;
            let adoptionCount = 0;
            let requestCount = 0;
            let flags: AdopterFlags | null = null;
            let adopterContext: ApplicantAdopterContext | null = null;

            if (row.linkedAdopterId) {
                const [adopter, records, flagRows] = await Promise.all([
                    db.select({
                        name: adopters.name,
                        addedBy: adopters.addedBy,
                        source: adopters.source,
                        country: adopters.country,
                    })
                        .from(adopters)
                        .where(eq(adopters.id, row.linkedAdopterId))
                        .get() as Promise<{ name: string; addedBy: string | null; source: string | null; country: string | null } | undefined>,
                    db.select({ rating: adoptions.rating, recordType: adoptions.recordType })
                        .from(adoptions)
                        .where(eq(adoptions.adopterId, row.linkedAdopterId))
                        .all() as Promise<Array<{ rating: number | null; recordType: string | null }>>,
                    db.select({ reason: adopterFlags.reason })
                        .from(adopterFlags)
                        .where(eq(adopterFlags.adopterId, row.linkedAdopterId))
                        .all() as Promise<Array<{ reason: string | null }>>,
                ]);
                if (adopter) {
                    adopterName = adopter.name;
                    adopterContext = {
                        addedBy: adopter.addedBy,
                        source: adopter.source,
                        country: adopter.country,
                    };
                }
                adopterRating = computeAvgRating(records);
                for (const r of records) {
                    if (r.recordType === 'adoption') adoptionCount++;
                    else if (r.recordType === 'adoption_request') requestCount++;
                }
                const reasons = flagRows.map(f => f.reason).filter((r): r is string => !!r);
                // systemDuplicateCount=0 here — looking up duplicate_candidates per
                // applicant would add another N queries with no UI consumer (panel
                // surfaces flag pills, not the system-duplicate badge). If we ever
                // surface it, add a third parallel query above.
                flags = buildFlags(reasons, 0);
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
                flags,
                adoptionCount,
                requestCount,
                intent: row.intent,
                species: row.species,
                lifeStage: row.lifeStage,
                submission: {
                    email: row.email,
                    phone: row.phone,
                    address: row.address,
                    selfieUrl: row.selfieUrl,
                    latitude: row.latitude,
                    longitude: row.longitude,
                    household: parseHousehold(row.household),
                    answersJson: row.answersJson,
                },
                adopterContext,
            } satisfies ApplicantSummary;
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
