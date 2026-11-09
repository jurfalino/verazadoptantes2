'use server';

import { adoptions, adopterHistory, adopterImages, animals, placements } from '@/db/schema';
import { eq, sql, and, or } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { getDb, getUser } from './_db';
import { deleteRecordById, softDeleteAnimal, isAnimalBacked, countAnimalLinks, deletePlacementForAdopter } from './_recordWrite';
import { decideAnimalFate, NO_LINKS, type AnimalLinks } from '@/domain/animalDeletion';
import { animalPrimaryFirst } from '@/lib/showcase';
import { historyKindFor } from '@/lib/profilePrivilege';
import { saveRecordFor, type RecordSaveResult, type RecordField } from '@/lib/recordSave';

export type { RecordFieldConflict, RecordSaveResult } from '@/lib/recordSave';

/** The browser door to the record save (src/lib/recordSave.ts): always tells the owner's team about an add. */
export async function saveAdoption(data: typeof adoptions.$inferInsert, opts?: { loaded?: Partial<Record<RecordField, unknown>> }): Promise<RecordSaveResult> {
    return saveRecordFor(data, opts, { notifyOwnerTeam: true });
}

/**
 * What deleting this record would do, so the UI can warn BEFORE anything is
 * destroyed rather than reporting afterwards.
 *
 * Read-only. Mirrors `deleteAdoption`'s reasoning exactly — if the two ever
 * diverge, the dialog lies, so any change to one belongs in the other.
 */
export async function getAdoptionDeleteImpact(adoptionId: string, adopterId: string): Promise<{
    kind: 'event' | 'animal';
    animalName: string | null;
    /** True when the animal has no other link and would go to the trash. */
    willDeleteAnimal: boolean;
    links: AnimalLinks;
}> {
    const fallback = { kind: 'event' as const, animalName: null, willDeleteAnimal: false, links: { ...NO_LINKS } };
    try {
        const db = await getDb();
        if (!db) return fallback;

        if (!(await isAnimalBacked(db, adoptionId))) return fallback;

        const animal = await db.select({ name: animals.name }).from(animals).where(eq(animals.id, adoptionId)).get();
        const active = await db.select({ id: placements.id }).from(placements)
            .where(and(eq(placements.animalId, adoptionId), eq(placements.adopterId, adopterId))).get();
        const links = await countAnimalLinks(db, adoptionId, active?.id ?? null);

        return {
            kind: 'animal',
            animalName: animal?.name ?? null,
            willDeleteAnimal: decideAnimalFate({ links }) === 'soft-delete',
            links,
        };
    } catch (error) {
        // Fail toward the quieter warning: never claim an animal is safe when we
        // could not check, and never block the delete on a probe failure.
        logger.warn('getAdoptionDeleteImpact failed; UI will show the generic confirm', {
            adoptionId, adopterId, error: error instanceof Error ? error.message : String(error),
        });
        return fallback;
    }
}

export async function deleteAdoption(adoptionId: string, adopterId: string, keepAnimal = false) {
    try {
        const db = await getDb();
        if (!db) throw new Error("No database");
        const changedBy = await getUser();

        // Get snapshot before delete
        const existing = await db.select().from(adoptions).where(eq(adoptions.id, adoptionId)).get();
        if (!existing) throw new Error("Adoption not found");

        // v2.19.68: previously UNGUARDED — any authenticated user could delete
        // any activity record. Gate to the record's creator OR an admin, matching
        // the UI (AdoptionHistory: canEdit = isAdmin || addedBy === currentUser).
        // v2.55.20: org-mates too — the UI now offers edit/delete on a
        // teammate's records (AdoptionHistory canEdit), so the server gate must
        // agree or the affordance fails on save. One rule: src/domain/recordEditAccess.ts.
        const { canEditRecordAs } = await import('@/lib/recordEditAccess');
        if (!(await canEditRecordAs(changedBy, existing.addedBy))) {
            throw new Error("Not authorized to delete this record");
        }

        // What this delete will actually do. The `adoptions` view UNIONs
        // animal-backed rows (id = animals.id) with event-backed rows
        // (id = adopter_events.id); the old code fired a delete at every table
        // on that one id, so removing a duplicate adoption destroyed the animal,
        // its images, and — the placement delete carried no adopter filter —
        // every OTHER rescuer's custody span for it. Two cats were lost that way
        // in production on 2026-09-07.
        const animalBacked = await isAnimalBacked(db, adoptionId);

        let animalOutcome: 'not-applicable' | 'kept' | 'soft-deleted' = 'not-applicable';

        if (!animalBacked) {
            // Event-backed record (observation / adoption_request / follow_up /
            // returned_pet): it owns no animal, so this is just the event.
            await deleteRecordById(db, adoptionId);
        } else {
            // Animal-backed. Remove ONLY this adopter's custody span, then let
            // the animal live or not based on what still refers to it.
            const removed = await deletePlacementForAdopter(db, adoptionId, adopterId);
            const links = await countAnimalLinks(db, adoptionId, removed?.id ?? null);
            const fate = decideAnimalFate({ links, keepAnimal });

            if (fate === 'soft-delete') {
                await softDeleteAnimal(db, adoptionId, changedBy);
                animalOutcome = 'soft-deleted';
            } else {
                animalOutcome = 'kept';
            }
        }

        // Log to adopter history — the record's author on someone else's
        // profile is a contributor there, not an editor.
        await db.insert(adopterHistory).values({
            id: crypto.randomUUID(),
            adopterId,
            changedBy,
            kind: await historyKindFor(db, adopterId, changedBy),
            changes: JSON.stringify({
                adoption_deleted: existing
            }),
            changedAt: new Date()
        });

        logAudit({ userEmail: changedBy, action: 'adoption_deleted', target: adoptionId, details: { adopterId, animalOutcome } });
        revalidatePath(`/adopter/${adopterId}`);
        revalidatePath('/my-animals');
        return { success: true, animalOutcome };
    } catch (error) {
        const errorId = logger.error('Delete adoption failed', error, { adoptionId, adopterId });
        throw new Error(`Failed to delete adoption (Error ID: ${errorId})`);
    }
}

/**
 * Pick the best thumbnail URL for each adoption row and attach it as
 * `thumbnailUrl` (v2.18.2). Used by the AdoptionFormWizard's existing-animal
 * picker so the user sees the animal's photo next to the name when choosing —
 * the previous native `<select>` could only render text. Profile-picture-
 * marked images win over other images; tiebreak by most-recent upload. We
 * fan out one query per adoption (D1-safe per CLAUDE.md, no `inArray`).
 *
 * The added cost is one extra DB round-trip per animal in the lists, which
 * runs in parallel — on a typical inventory of ~10 animals that adds well
 * under 100ms to the load and the visual-recognition win on the picker is
 * worth it.
 */
async function attachAdoptionThumbnails<T extends { id: string }>(
    db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
    rows: T[],
): Promise<Array<T & { thumbnailUrl: string | null }>> {
    if (rows.length === 0) return rows.map(r => ({ ...r, thumbnailUrl: null }));
    const thumbs = await Promise.all(rows.map(async (r) => {
        try {
            const img = await db.select({ url: adopterImages.url })
                .from(adopterImages)
                .where(eq(adopterImages.adoptionId, r.id))
                .orderBy(
                    // v2.56.86: the chosen lead photo wins outright. Only the
                    // flag is prepended — animalImagesOrder() ends in `rowid
                    // ASC`, which is unique and would make the existing
                    // "newest upload" tiebreakers below dead code, silently
                    // flipping this thumbnail to the OLDEST photo.
                    animalPrimaryFirst(),
                    sql`${adopterImages.isProfilePicture} DESC`,
                    sql`${adopterImages.uploadedAt} DESC`,
                )
                .limit(1)
                .get();
            return { id: r.id, url: img?.url ?? null };
        } catch {
            return { id: r.id, url: null };
        }
    }));
    const byId = new Map<string, string | null>();
    for (const t of thumbs) byId.set(t.id, t.url);
    return rows.map(r => ({ ...r, thumbnailUrl: byId.get(r.id) ?? null }));
}

export async function getAdoptions(adopterId: string) {
    // Every page that shows an adopter's history requires sign-in; the records
    // carry verified home addresses, notes and rescuer emails. Anonymous
    // callers get nothing.
    let viewer = '';
    try { viewer = await getUser(); } catch {
        logger.warn('getAdoptions: refused — no session', { adopterId });
        return [];
    }
    try {
        const db = await getDb();
        if (!db) return [];
        const results = await db.select().from(adoptions)
            .where(eq(adoptions.adopterId, adopterId))
            .orderBy(sql`${adoptions.date} DESC`)
            .all();
        // Defensive dedup — protect against SQLite index corruption returning same row twice
        const seen = new Set<string>();
        const deduped = results.filter((r: { id: string }) => {
            if (seen.has(r.id)) return false;
            seen.add(r.id);
            return true;
        });
        // Requests count per rescue on the profile too (src/domain/requestDensity.ts).
        const { loadOrgMembership, loadAdminEmails, withOpaqueRescueKeys } = await import('@/lib/rescueKeys');
        const { groupRescues } = await import('@/domain/requestDensity');
        const hasRequests = deduped.some((r: { recordType: string | null }) => r.recordType === 'adoption_request');
        const hasContracts = deduped.some((r: { hasContract?: number | null }) => r.hasContract === 1);
        const membership = hasRequests || hasContracts ? await loadOrgMembership(db, 'getAdoptions') : new Map<string, string[]>();
        const keys = hasRequests ? groupRescues(membership, await loadAdminEmails(db, 'getAdoptions')) : new Map<string, string>();
        // Answers of an API-sent form: only for the rescue that registered it, and admins.
        const { attachActivityForms } = await import('@/lib/activityForms');
        const { isAdminAsync } = await import('@/config/admins');
        const { sameRescueDirect } = await import('@/lib/rescueKeys');
        const viewerIsAdmin = await isAdminAsync(viewer);
        // A signed contract opens only for the animal's rescue and admins
        // (/api/files/contract): nobody else gets a link that would just 404.
        const visible = (deduped as Array<{ hasContract?: number | null; addedBy?: string | null }>).map(r =>
            r.hasContract === 1 && !viewerIsAdmin && !sameRescueDirect(viewer, r.addedBy, membership) ? { ...r, hasContract: 0 } : r);
        // H1: «Datos y posibles duplicados» — after the gate above, so only the PDF's audience gets the id.
        const { attachSignedContractIds } = await import('@/lib/signedContractIds');
        const withContracts = await attachSignedContractIds(db, visible as Array<{ id: string; hasContract?: number | null; addedBy?: string | null }>, { op: 'getAdoptions', adopterId });
        // Opaque labels for the browser: the grouping, never other rescuers' organizations.
        const withForms = await attachActivityForms(db, withOpaqueRescueKeys(withContracts as Array<{ id: string; addedBy?: string | null; recordType?: string | null }>, keys), viewer, viewerIsAdmin, membership);
        // Which API tool saved each activity — only while the origin tags are on.
        const { getFeatureFlag } = await import('@/config/features');
        const withOrigin = await getFeatureFlag('ENABLE_ORIGIN_LABELS') ? await attachApiTools(db, withForms) : withForms;
        // `canEdit` per record (the pencil = the save gate) + the delivery address masked outside the team.
        const { attachRecordViewerAccess } = await import('@/lib/recordEditAccess');
        return await attachRecordViewerAccess(db, await attachAdoptionThumbnails(db, withOrigin), { viewer, viewerIsAdmin, adopterId });
    } catch (error) {
        logger.error('Get adoptions failed', error, { adopterId });
        return [];
    }
}

export async function getAvailableAnimals() {
    try {
        const db = await getDb();
        if (!db) return [];
        const { auth } = await import('@/auth');
        const session = await auth();
        if (!session?.user?.email) return [];

        // Unlinked inventory (adopterId IS NULL) PLUS animals currently in a
        // foster home (recordType='foster'). Fostered animals stay "placeable" —
        // they can still be given for adoption or moved to another foster home —
        // so the wizard picker must list them for the animalId prefill match to
        // resolve on a foster→adoption / foster→foster save.
        // v2.55.18: animals are team resources — the picker spans the org.
        // OR fan-out per email, NEVER `IN ${array}` (documented-broken on D1).
        const { getTeamEmails } = await import('@/lib/orgMembership');
        const teamEmails = await getTeamEmails(session.user.email);
        // Fail closed — see the note in /api/my-animals: an empty list would
        // otherwise drop the owner filter entirely.
        const scopeEmails = teamEmails.length > 0 ? teamEmails : [session.user.email];
        const rows = await db.select().from(adoptions)
            .where(and(
                or(...scopeEmails.map(e => eq(adoptions.addedBy, e))),
                sql`(${adoptions.adopterId} IS NULL OR ${adoptions.recordType} = 'foster')`,
            ));
        return await attachAdoptionThumbnails(db, rows);
    } catch (error) {
        logger.error('getAvailableAnimals failed', error);
        return [];
    }
}

/**
 * Delete an animal-for-adoption record + its images.
 * Verifies the current user is the one who added it.
 */
export async function deleteAnimalForAdoption(adoptionId: string) {
    try {
        const db = await getDb();
        if (!db) throw new Error("No database");
        const changedBy = await getUser();

        // Verify ownership
        const existing = await db.select().from(adoptions).where(eq(adoptions.id, adoptionId)).get();
        if (!existing) throw new Error("Animal not found");
        // v2.19.66: admins may delete any record, not just the owner.
        // v2.55.18: org-mates get full parity (attribution is the counterweight).
        const { isAdminAsync } = await import('@/config/admins');
        const { isOwnerOrOrgMate } = await import('@/lib/orgMembership');
        if (!(await isOwnerOrOrgMate(changedBy, existing.addedBy)) && !await isAdminAsync(changedBy)) throw new Error("Not authorized to delete this animal");

        // v2.55.20: SOFT delete — team parity (any org member can delete a
        // teammate's animal) makes an unrecoverable wipe of a documented
        // history unacceptable. Falls back to the hard delete only if the id
        // isn't an animal row (defensive; this action is animal-only).
        const soft = await softDeleteAnimal(db, adoptionId, changedBy);
        if (!soft) await deleteRecordById(db, adoptionId);

        logAudit({ userEmail: changedBy, action: 'animal_for_adoption_deleted', target: adoptionId, details: { animalName: existing.animalName, soft } });
        revalidatePath('/my-animals');
        logger.info('Animal for adoption deleted', { adoptionId, animalName: existing.animalName, changedBy });

        return { success: true };
    } catch (error) {
        const errorId = logger.error('Delete animal for adoption failed', error, { adoptionId });
        throw new Error(`Failed to delete animal (Error ID: ${errorId})`);
    }
}

/**
 * Delete a single image from an animal-for-adoption record.
 * Verifies the current user owns the parent adoption.
 */
export async function deleteAnimalImage(imageId: string, adoptionId: string) {
    try {
        const db = await getDb();
        if (!db) throw new Error("No database");
        const changedBy = await getUser();

        // Verify ownership via the parent adoption
        const adoption = await db.select().from(adoptions).where(eq(adoptions.id, adoptionId)).get();
        if (!adoption) throw new Error("Animal not found");
        // v2.19.66: admins may delete any record, not just the owner.
        // v2.55.18: org-mates get full parity (attribution is the counterweight).
        const { isAdminAsync } = await import('@/config/admins');
        const { isOwnerOrOrgMate } = await import('@/lib/orgMembership');
        if (!(await isOwnerOrOrgMate(changedBy, adoption.addedBy)) && !await isAdminAsync(changedBy)) throw new Error("Not authorized to delete this image");

        const { adopterImages } = await import('@/db/schema');

        // Verify image exists and belongs to this adoption
        const existing = await db.select().from(adopterImages).where(eq(adopterImages.id, imageId)).get();
        if (!existing) throw new Error("Image not found");

        await db.delete(adopterImages).where(eq(adopterImages.id, imageId));

        logAudit({ userEmail: changedBy, action: 'animal_image_deleted', target: imageId, details: { adoptionId } });
        revalidatePath('/my-animals');
        logger.info('Animal image deleted', { imageId, adoptionId, changedBy });

        return { success: true };
    } catch (error) {
        const errorId = logger.error('Delete animal image failed', error, { imageId, adoptionId });
        throw new Error(`Failed to delete image (Error ID: ${errorId})`);
    }
}


/** `apiTool` (the key's name) on activities an API call saved and that are still live. One indexed lookup per record. */
async function attachApiTools<T extends { id: string }>(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, records: T[]): Promise<Array<T & { apiTool?: string }>> {
    const { apiRequests, apiKeys } = await import('@/db/schema');
    const { isNull } = await import('drizzle-orm');
    const tools = await Promise.all(records.map(r =>
        db.select({ name: apiKeys.name }).from(apiRequests).innerJoin(apiKeys, eq(apiKeys.id, apiRequests.keyId))
            .where(and(eq(apiRequests.recordId, r.id), eq(apiRequests.endpoint, 'search'), eq(apiRequests.httpStatus, 200), isNull(apiRequests.voidedAt)))
            .get()
            .catch((e: unknown) => {
                logger.warn('getAdoptions: api origin D1 fallback hit', { recordId: r.id, error: e instanceof Error ? e.message : String(e) });
                return undefined;
            }) as Promise<{ name: string } | undefined>));
    return records.map((r, i) => tools[i]?.name ? { ...r, apiTool: tools[i]!.name } : r);
}
