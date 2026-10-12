/**
 * Applicant reads + the team access rule behind them. NOT a `'use server'`
 * module: every export of one is a public endpoint, and these helpers take
 * the scope as an argument and trust the caller to have authorized it.
 * Callers: `getApplicantsForAnimal` (applicants.ts — the gated action),
 * `/api/my-animals` (the card count), `/form-results/[id]` and the
 * form-submission prefill/link actions.
 *
 * The scope rule itself (owner's team, fail closed, case-insensitive) lives in
 * `src/lib/applicantScope.ts` so the page and the card share it verbatim.
 */

import { logger } from '@/lib/logger';
import { computeAvgRating } from '@/domain/ratings';
import { buildFlags } from '@/domain/flags';
import { applicantScopeWhere } from '@/lib/applicantScope';
import type { AdopterFlags } from '@/types/adopter';
import type { ApplicantSummary, ApplicantAdopterContext } from './applicants';
import type { FormSubmissionRef } from '@/lib/formSubmissionAccess';

/* eslint-disable @typescript-eslint/no-explicit-any -- the D1/better-sqlite db union is untyped here, as in the callers */
type Db = any;

/**
 * Owner, org-mate of the owner, or admin. The animal gate in
 * `getAnimalProfile` admits admins too (they can already delete the animal
 * and edit its events), so applicants and form results follow it — otherwise
 * an admin on an animal page they may modify sees the applicants block
 * silently missing. Admin is checked only after the cheaper team check fails.
 */
export async function isOwnerOrgMateOrAdmin(
    viewerEmail: string | null | undefined,
    ownerEmail: string | null | undefined,
): Promise<boolean> {
    const { isOwnerOrOrgMate } = await import('@/lib/orgMembership');
    if (await isOwnerOrOrgMate(viewerEmail, ownerEmail)) return true;
    const { isAdminAsync } = await import('@/config/admins');
    return isAdminAsync(viewerEmail);
}

/**
 * May `viewerEmail` open / act on a form submission? The ONE rule shared by
 * /form-results, the «Crear adoptante» prefill and «Vincular» — see
 * src/lib/formSubmissionAccess.ts (form-link owner's team, admin, or the
 * animal owner's team with the form link inside it). Pass the submission
 * row when the caller already has it, else its id. False when it does not
 * exist.
 */
export async function canAccessFormSubmission(
    db: Db,
    submission: string | FormSubmissionRef,
    viewerEmail: string | null | undefined,
): Promise<boolean> {
    if (!viewerEmail) return false;
    const { formSubmissions, animals } = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');
    let ref: FormSubmissionRef | undefined;
    if (typeof submission === 'string') {
        if (!submission) return false;
        ref = await db.select({ userId: formSubmissions.userId, selectedAnimalId: formSubmissions.selectedAnimalId })
            .from(formSubmissions)
            .where(eq(formSubmissions.id, submission))
            .get() as FormSubmissionRef | undefined;
    } else {
        ref = submission;
    }
    if (!ref) return false;

    // STRICT variants: a D1 failure throws instead of reading as "not a
    // teammate / not an admin", so callers show an error with its errorId
    // (and log it) rather than a 404 to someone who is allowed in.
    const { isOrgMateStrict, getTeamEmails } = await import('@/lib/orgMembership');
    const { isAdminAsyncStrict } = await import('@/config/admins');
    const { canViewerAccessFormSubmission } = await import('@/lib/formSubmissionAccess');
    const norm = (e: string | null | undefined) => (e ?? '').trim().toLowerCase();
    return canViewerAccessFormSubmission(viewerEmail, ref, {
        isOwnerOrOrgMate: async (viewer, owner) => {
            const v = norm(viewer), o = norm(owner);
            if (!v || !o) return false;
            return v === o || isOrgMateStrict(v, o);
        },
        isAdmin: isAdminAsyncStrict,
        getTeamEmails,
        // Same table and deleted-check as the animal page (getAnimalProfile).
        getAnimalOwner: async (animalId) => {
            const animal = await db.select({ addedBy: animals.addedBy, deletedAt: animals.deletedAt })
                .from(animals)
                .where(eq(animals.id, animalId))
                .get() as { addedBy: string | null; deletedAt: unknown } | undefined;
            return animal && !animal.deletedAt ? animal.addedBy : null;
        },
    });
}

/**
 * Memoised `getTeamEmails` per animal owner, for one request. /my-animals
 * shows many animals from a handful of owners (self + org-mates); resolving
 * each owner's team once keeps the org queries flat instead of per card.
 */
export function createOwnerTeamResolver(): (ownerEmail: string | null | undefined) => Promise<string[]> {
    const cache = new Map<string, Promise<string[]>>();
    return (ownerEmail) => {
        const key = (ownerEmail ?? '').trim().toLowerCase();
        if (!key) return Promise.resolve([]);
        let hit = cache.get(key);
        if (!hit) {
            hit = import('@/lib/orgMembership').then(m => m.getTeamEmails(key));
            cache.set(key, hit);
        }
        return hit;
    };
}

/**
 * Submission ids only — what the /my-animals card needs for its count. One
 * query per animal, same WHERE as the full list. Fails closed to [] (no
 * query) when the team scope is empty.
 */
export async function listApplicantIdsForAnimal(
    db: Db,
    animalId: string,
    teamEmails: readonly string[],
): Promise<Array<{ submissionId: string }>> {
    const where = applicantScopeWhere(animalId, teamEmails);
    if (!where) return [];
    const { formSubmissions } = await import('@/db/schema');
    const rows = await db.select({ id: formSubmissions.id })
        .from(formSubmissions)
        .where(where)
        .all() as Array<{ id: string }>;
    return rows.map(r => ({ submissionId: r.id }));
}

/**
 * The full, enriched applicant list for one animal within `teamEmails` (the
 * animal OWNER's team). The caller has already authorized the viewer.
 *
 * D1-safe: per-row enrichment uses Promise.all with one `eq(id)` each
 * (per CLAUDE.md, no `inArray`).
 */
export async function loadApplicantsForAnimal(
    db: Db,
    animal: { id: string; adopterId: string | null },
    teamEmails: readonly string[],
): Promise<ApplicantSummary[]> {
    const animalId = animal.id;
    const where = applicantScopeWhere(animalId, teamEmails);
    if (!where) {
        logger.warn('loadApplicantsForAnimal: empty team scope — failing closed', { animalId });
        return [];
    }

    const { formSubmissions, adopters, adoptions, contractInvitations, adopterFlags } = await import('@/db/schema');
    const { eq, and, isNull } = await import('drizzle-orm');

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
        .where(where)
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
                    addedByName: null, // filled below in one batched lookup
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

    // "Agregado por": the rescuer's name, not their email handle. One
    // batched, D1-safe lookup for every distinct addedBy on this animal.
    const addedByEmails = enriched
        .map(a => a.adopterContext?.addedBy)
        .filter((e): e is string => !!e);
    if (addedByEmails.length > 0) {
        try {
            const { resolveDisplayNames } = await import('./notifications');
            const names = await resolveDisplayNames(addedByEmails);
            for (const a of enriched) {
                const ctx = a.adopterContext;
                if (ctx?.addedBy) ctx.addedByName = names.get(ctx.addedBy.toLowerCase()) ?? null;
            }
        } catch (e) {
            // Names degrade to the email handle at render; never lose the list.
            logger.warn('getApplicantsForAnimal: addedBy name lookup fallback', {
                animalId, count: addedByEmails.length,
                error: e instanceof Error ? e.message : String(e),
            });
        }
    }

    // Newest first.
    enriched.sort((a, b) => (b.appliedAt ?? 0) - (a.appliedAt ?? 0));
    return enriched;
}
