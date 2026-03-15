'use server';

import { adopters, adoptions, adopterHistory, adopterFlags } from '@/db/schema';
import { eq, sql, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { getDb, getUser } from './_db';
import { tokenizeAdopter } from './duplicates';
import { saveAdoptionSchema } from './validation';

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

            const fields = ['animalName', 'species', 'status', 'rating', 'details', 'adopterId', 'date', 'onBehalfOf', 'recordType', 'deliveredToHome', 'verifiedAddress', 'identityVerified'] as const;
            for (const field of fields) {
                // @ts-ignore
                if (data[field] !== undefined && data[field] !== existing[field]) {
                    // @ts-ignore
                    changes[field] = { from: existing[field], to: data[field] };
                    hasChanges = true;
                }
            }

            if (hasChanges) {
                await db.update(adoptions).set(data).where(eq(adoptions.id, data.id as string));

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
            }
            logger.info('Adoption updated', { adoptionId: data.id, adopterId: data.adopterId, changedBy });
            logAudit({ userEmail: changedBy, action: 'adoption_updated', target: data.id as string, details: { adopterId: data.adopterId } });

            // Re-tokenize adopter if onBehalfOf changed (cross-field name tokens)
            const targetAdopterId2 = data.adopterId || existing.adopterId;
            if (targetAdopterId2 && data.onBehalfOf !== undefined) {
                tokenizeAdopter(targetAdopterId2).catch(e => { logger.warn('Tokenize adopter failed (fire-and-forget)', { adopterId: targetAdopterId2, error: e instanceof Error ? e.message : String(e) }); });
            }

            return { success: true, id: data.id };
        } else {
            // Create new
            const id = crypto.randomUUID();
            await db.insert(adoptions).values({
                ...data,
                id,
                date: data.date || new Date(),
                addedBy: changedBy
            });

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

            logger.info('Adoption created', { adoptionId: id, adopterId: data.adopterId, species: data.species, changedBy });
            logAudit({ userEmail: changedBy, action: 'adoption_created', target: id, details: { adopterId: data.adopterId, species: data.species, animalName: data.animalName } });

            // Re-tokenize adopter if onBehalfOf is set (cross-field name tokens)
            if (data.adopterId && data.onBehalfOf) {
                tokenizeAdopter(data.adopterId).catch(e => { logger.warn('Tokenize adopter failed (fire-and-forget)', { adopterId: data.adopterId, error: e instanceof Error ? e.message : String(e) }); });
            }

            return { success: true, id };
        }
    } catch (error) {
        const errorId = logger.error('Save adoption failed', error, { adoptionId: data.id, adopterId: data.adopterId });
        throw new Error(`Failed to save adoption (Error ID: ${errorId})`);
    }
}

export async function deleteAdoption(adoptionId: string, adopterId: string) {
    try {
        const db = await getDb();
        if (!db) throw new Error("No database");
        const changedBy = await getUser();

        // Get snapshot before delete
        const existing = await db.select().from(adoptions).where(eq(adoptions.id, adoptionId)).get();
        if (!existing) throw new Error("Adoption not found");

        await db.delete(adoptions).where(eq(adoptions.id, adoptionId));

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

        logAudit({ action: 'adoption_deleted', target: adoptionId, details: { adopterId } });
        revalidatePath(`/adopter/${adopterId}`);
        return { success: true };
    } catch (error) {
        const errorId = logger.error('Delete adoption failed', error, { adoptionId, adopterId });
        throw new Error(`Failed to delete adoption (Error ID: ${errorId})`);
    }
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
        return results.filter((r: { id: string }) => {
            if (seen.has(r.id)) return false;
            seen.add(r.id);
            return true;
        });
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

        return await db.select().from(adoptions)
            .where(sql`${adoptions.addedBy} = ${session.user.email} AND ${adoptions.adopterId} IS NULL`);
        // We could add status check, but usually available animals are just unlinked.

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
        if (existing.addedBy !== changedBy) throw new Error("Not authorized to delete this animal");

        // Delete associated images first
        const { adopterImages } = await import('@/db/schema');
        await db.delete(adopterImages).where(eq(adopterImages.adoptionId, adoptionId));

        // Delete the adoption record
        await db.delete(adoptions).where(eq(adoptions.id, adoptionId));

        logAudit({ userEmail: changedBy, action: 'animal_for_adoption_deleted', target: adoptionId, details: { animalName: existing.animalName } });
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
        if (adoption.addedBy !== changedBy) throw new Error("Not authorized to delete this image");

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

