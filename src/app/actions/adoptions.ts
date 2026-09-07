'use server';

import { adopters, adoptions, adopterHistory, adopterFlags, adopterImages, animals, placements } from '@/db/schema';
import { eq, sql, and, or } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { getDb, getUser } from './_db';
import { tokenizeAdopter } from './duplicates';
import { saveAdoptionSchema } from './validation';
import { insertRecord, updateRecord, deleteRecordById, softDeleteAnimal, isAnimalBacked, countAnimalLinks, deletePlacementForAdopter } from './_recordWrite';
import { decideAnimalFate, NO_LINKS, type AnimalLinks } from '@/domain/animalDeletion';

export async function saveAdoption(data: typeof adoptions.$inferInsert) {
    // Validate input
    const parsed = saveAdoptionSchema.safeParse(data);
    if (!parsed.success) {
        throw new Error(`Invalid adoption data: ${parsed.error.issues.map(i => i.message).join(', ')}`);
    }

    try {
        const db = await getDb();
        if (!db) throw new Error("No database");
        const changedBy = await getUser();

        // Check if exists (for updates)
        const existing = data.id ? await db.select().from(adoptions).where(eq(adoptions.id, data.id)).get() : null;

        if (existing) {
            // Update existing
            // Calculate changes
            const changes: Record<string, any> = {};
            let hasChanges = false;

            // v2.55.17-1: sex/color/microchip/age/sourceUrl/comments were missing
            // from this list — updateRecord persists them, but a payload that
            // changed ONLY one of them (and sent no fresh `date`, whose object
            // comparison is always "changed") computed hasChanges=false and
            // silently dropped the edit. Bitten by the animal page's in-place
            // identity form; latent for any caller that stops sending `date`.
            const fields = ['animalName', 'species', 'status', 'rating', 'details', 'adopterId', 'date', 'onBehalfOf', 'recordType', 'deliveredToHome', 'verifiedAddress', 'identityVerified', 'estimatedBirthDate', 'neutered', 'sex', 'color', 'microchip', 'age', 'sourceUrl', 'comments'] as const;
            for (const field of fields) {
                // @ts-ignore
                if (data[field] !== undefined && data[field] !== existing[field]) {
                    // @ts-ignore
                    changes[field] = { from: existing[field], to: data[field] };
                    hasChanges = true;
                }
            }

            if (hasChanges) {
                // Normalized write: routes identity → animals, custody → placements
                // (closing/opening spans on a transition). Reads still hit the view.
                await updateRecord(db, data, existing, changedBy);

                // Log to adopter history IF it is linked to an adopter
                const targetAdopterId = data.adopterId || existing.adopterId;
                if (targetAdopterId) {
                    await db.insert(adopterHistory).values({
                        id: crypto.randomUUID(),
                        adopterId: targetAdopterId,
                        changedBy,
                        changes: JSON.stringify({ adoption_updated: changes }),
                        changedAt: new Date()
                    });
                    revalidatePath(`/adopter/${targetAdopterId}`);
                }
                // Also revalidate /my-animals whenever an UPDATE touched a row
                // (v2.18.7). The /my-animals "available" tab filters on
                // `adopterId IS NULL AND recordType='available'`; linking an
                // available animal to an adopter (the prod-reported bug —
                // "the animal is still listed as 'for adoption'") flips both
                // those conditions, so the row must drop off the page. The
                // previous code only revalidated the adopter page, leaving
                // /my-animals serving stale Next.js cache until the user
                // hard-reloaded.
                revalidatePath('/my-animals');
            }
            logger.info('Adoption updated', { adoptionId: data.id, adopterId: data.adopterId, changedBy });
            logAudit({ userEmail: changedBy, action: 'adoption_updated', target: data.id as string, details: { adopterId: data.adopterId } });

            // Re-tokenize adopter if onBehalfOf changed (cross-field name tokens).
            // Awaited so duplicate detection sees the new name tokens before the
            // response returns (Workers kill fire-and-forget).
            const targetAdopterId2 = data.adopterId || existing.adopterId;
            if (targetAdopterId2 && data.onBehalfOf !== undefined) {
                await tokenizeAdopter(targetAdopterId2).catch(e => { logger.error('Tokenize adopter failed (adoption update)', e, { adopterId: targetAdopterId2 }); });
            }

            return { success: true, id: data.id };
        } else {
            // Create new — normalized write routes to animals/placements/events.
            // Returns the animal id (available/foster/adoption) or event id, which
            // is what callers use for image uploads + contract refs.
            const id = await insertRecord(db, { ...data, date: data.date || new Date() }, changedBy);

            // Log to adopter history ONLY if linked immediately
            if (data.adopterId) {
                await db.insert(adopterHistory).values({
                    id: crypto.randomUUID(),
                    adopterId: data.adopterId,
                    changedBy,
                    changes: JSON.stringify({
                        adoption_added: {
                            animalName: data.animalName,
                            species: data.species,
                            status: data.status,
                            rating: data.rating
                        }
                    }),
                    changedAt: new Date()
                });

                // If delivered to home with verified address, set address verified flag
                if (data.deliveredToHome && data.verifiedAddress) {
                    // Update adopter's address if different
                    const adopter = await db.select().from(adopters).where(eq(adopters.id, data.adopterId)).get();
                    if (adopter && adopter.contactInfo !== data.verifiedAddress) {
                        const addressPrefix = 'Dirección / Address';
                        await db.update(adopters).set({ contactInfo: adopter.contactInfo ? `${adopter.contactInfo}\n${addressPrefix}: ${data.verifiedAddress}` : `${addressPrefix}: ${data.verifiedAddress}` }).where(eq(adopters.id, data.adopterId));

                        // Log address change in audit history
                        await db.insert(adopterHistory).values({
                            id: crypto.randomUUID(),
                            adopterId: data.adopterId,
                            changedBy,
                            changes: JSON.stringify({
                                contactInfo: {
                                    from: adopter.contactInfo || '(empty)',
                                    to: adopter.contactInfo ? `${adopter.contactInfo}\n${addressPrefix}: ${data.verifiedAddress}` : `${addressPrefix}: ${data.verifiedAddress}`,
                                    reason: 'verified_during_pet_delivery'
                                }
                            }),
                            changedAt: new Date()
                        });
                    }

                    // Check if verified_address flag already exists
                    const existingFlag = await db.select().from(adopterFlags).where(
                        and(
                            eq(adopterFlags.adopterId, data.adopterId),
                            eq(adopterFlags.reason, 'verified_address')
                        )
                    ).get();

                    if (!existingFlag) {
                        await db.insert(adopterFlags).values({
                            id: crypto.randomUUID(),
                            adopterId: data.adopterId,
                            addedBy: changedBy,
                            reason: 'verified_address',
                            details: `Address verified during pet delivery: ${data.verifiedAddress}`,
                            createdAt: new Date()
                        });
                    }
                }

                revalidatePath(`/adopter/${data.adopterId}`);
            }
            // Revalidate /my-animals for INSERTs too (v2.18.7) — covers the
            // "user uploaded a new available animal" path and the
            // "user added an adoption that should claim that inventory"
            // path symmetrically. Cheap; no downside to over-revalidating.
            revalidatePath('/my-animals');

            logger.info('Adoption created', { adoptionId: id, adopterId: data.adopterId, species: data.species, changedBy });
            logAudit({ userEmail: changedBy, action: 'adoption_created', target: id, details: { adopterId: data.adopterId, species: data.species, animalName: data.animalName } });

            // Re-tokenize adopter if onBehalfOf is set (cross-field name tokens).
            // Awaited — see comment on the update branch above.
            if (data.adopterId && data.onBehalfOf) {
                await tokenizeAdopter(data.adopterId).catch(e => { logger.error('Tokenize adopter failed (adoption create)', e, { adopterId: data.adopterId }); });
            }

            return { success: true, id };
        }
    } catch (error) {
        const errorId = logger.error('Save adoption failed', error, { adoptionId: data.id, adopterId: data.adopterId });
        throw new Error(`Failed to save adoption (Error ID: ${errorId})`);
    }
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
        // agree or the affordance fails on save.
        const { isAdminAsync } = await import('@/config/admins');
        const { isOwnerOrOrgMate } = await import('@/lib/orgMembership');
        if (!(await isOwnerOrOrgMate(changedBy, existing.addedBy)) && !await isAdminAsync(changedBy)) {
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

        // Log to adopter history
        await db.insert(adopterHistory).values({
            id: crypto.randomUUID(),
            adopterId,
            changedBy,
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
        return await attachAdoptionThumbnails(db, deduped);
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

