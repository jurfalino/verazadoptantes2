'use server';

import { adopterImages, adopterHistory, adopters } from '@/db/schema';
import { eq, sql, and, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { logger } from '@/lib/logger';
import { getDb, getUser } from './_db';
import { processImageForStorage } from '@/lib/r2';

export async function saveImage(adopterId: string, url: string, caption?: string, adoptionId?: string, mediaType?: string, isProfilePicture?: boolean) {
    try {
        const db = await getDb();
        if (!db) throw new Error("No database");
        const addedBy = await getUser();

        const id = crypto.randomUUID();

        // Persist external URLs (Facebook CDN etc.) to R2 for permanent storage
        const persistedUrl = await processImageForStorage(url, adopterId, id);

        // If marking this image as the profile picture, demote any existing one first
        // so the "exactly one profile picture per adopter" invariant holds.
        if (isProfilePicture) {
            await db.update(adopterImages)
                .set({ isProfilePicture: 0 })
                .where(and(
                    eq(adopterImages.adopterId, adopterId),
                    eq(adopterImages.isProfilePicture, 1)
                ));
        }

        await db.insert(adopterImages).values({
            id,
            adopterId,
            adoptionId: adoptionId || null,
            url: persistedUrl,
            caption: caption || null,
            uploadedAt: new Date(),
            addedBy,
            mediaType: mediaType || 'image',
            isProfilePicture: isProfilePicture ? 1 : 0,
        });

        if (isProfilePicture) {
            revalidatePath(`/adopter/${adopterId}`);
        }

        // v2.18.11: owner awareness on non-self image uploads.
        (async () => {
            try {
                const a = await db.select({ addedBy: adopters.addedBy, name: adopters.name })
                    .from(adopters).where(eq(adopters.id, adopterId)).get();
                if (a?.addedBy && a.addedBy !== addedBy) {
                    const { notifyOwnerOfOrgMateChange } = await import('@/app/actions/notifications');
                    await notifyOwnerOfOrgMateChange({
                        adopterId,
                        adopterName: a.name || '',
                        ownerEmail: a.addedBy,
                        editorEmail: addedBy,
                        changeKind: isProfilePicture ? 'profile_picture_set' : 'image_added',
                        summary: isProfilePicture ? 'Cambió la foto de perfil.' : 'Subió una foto.',
                    });
                }
            } catch (e) {
                logger.warn('saveImage: owner notify dispatch failed', {
                    adopterId, error: e instanceof Error ? e.message : String(e),
                });
            }
        })();

        return { success: true, id };
    } catch (error) {
        const errorId = logger.error('Save image failed', error, { adopterId, isProfilePicture: !!isProfilePicture });
        throw new Error(`Failed to save image (Error ID: ${errorId})`);
    }
}

export async function getImages(adopterId: string) {
    try {
        const db = await getDb();
        if (!db) return [];
        // Only return profile images (where adoptionId is null)
        // Adoption-linked images are fetched via getAdoptionImages
        return await db.select().from(adopterImages)
            .where(and(
                eq(adopterImages.adopterId, adopterId),
                isNull(adopterImages.adoptionId)
            ))
            .orderBy(sql`${adopterImages.uploadedAt} DESC`)
            .all();
    } catch (error) {
        logger.error('Get images failed', error, { adopterId });
        return [];
    }
}

export async function setProfilePicture(adopterId: string, imageId: string) {
    try {
        const db = await getDb();
        if (!db) throw new Error("No database");

        // First, unset any existing profile picture for this adopter
        await db.update(adopterImages)
            .set({ isProfilePicture: 0 })
            .where(and(
                eq(adopterImages.adopterId, adopterId),
                eq(adopterImages.isProfilePicture, 1)
            ));

        // Then set the new profile picture
        await db.update(adopterImages)
            .set({ isProfilePicture: 1 })
            .where(eq(adopterImages.id, imageId));

        revalidatePath(`/adopter/${adopterId}`);

        // v2.18.11: owner awareness when a non-self picks the profile picture.
        (async () => {
            try {
                const actor = await getUser();
                const a = await db.select({ addedBy: adopters.addedBy, name: adopters.name })
                    .from(adopters).where(eq(adopters.id, adopterId)).get();
                if (a?.addedBy && a.addedBy !== actor) {
                    const { notifyOwnerOfOrgMateChange } = await import('@/app/actions/notifications');
                    await notifyOwnerOfOrgMateChange({
                        adopterId,
                        adopterName: a.name || '',
                        ownerEmail: a.addedBy,
                        editorEmail: actor,
                        changeKind: 'profile_picture_set',
                        summary: 'Cambió la foto de perfil.',
                    });
                }
            } catch (e) {
                logger.warn('setProfilePicture: owner notify dispatch failed', {
                    adopterId, error: e instanceof Error ? e.message : String(e),
                });
            }
        })();

        return { success: true };
    } catch (error) {
        const errorId = logger.error('Set profile picture failed', error, { adopterId, imageId });
        throw new Error(`Failed to set profile picture (Error ID: ${errorId})`);
    }
}

export async function getAdoptionImages(adoptionId: string) {
    try {
        const db = await getDb();
        if (!db) return [];
        return await db.select().from(adopterImages)
            .where(eq(adopterImages.adoptionId, adoptionId))
            .orderBy(sql`${adopterImages.uploadedAt} DESC`)
            .all();
    } catch (error) {
        logger.error('Get adoption images failed', error, { adoptionId });
        return [];
    }
}

export async function deleteImage(imageId: string, adopterId: string) {
    try {
        const db = await getDb();
        if (!db) throw new Error("No database");
        const changedBy = await getUser();

        // Get snapshot
        const existing = await db.select().from(adopterImages).where(eq(adopterImages.id, imageId)).get();
        if (!existing) throw new Error("Image not found");

        await db.delete(adopterImages).where(eq(adopterImages.id, imageId));

        // Log to history
        await db.insert(adopterHistory).values({
            id: crypto.randomUUID(),
            adopterId,
            changedBy,
            changes: JSON.stringify({
                image_deleted: {
                    caption: existing.caption,
                    // Don't log the full base64/url to save space, just metadata
                    uploadedAt: existing.uploadedAt
                }
            }),
            changedAt: new Date()
        });

        revalidatePath(`/adopter/${adopterId}`);
        return { success: true };
    } catch (error) {
        const errorId = logger.error('Delete image failed', error, { imageId, adopterId });
        throw new Error(`Failed to delete image (Error ID: ${errorId})`);
    }
}
