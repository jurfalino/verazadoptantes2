'use server';

import { adopterImages, adopterHistory } from '@/db/schema';
import { eq, sql, and, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { logger } from '@/lib/logger';
import { getDb, getUser } from './_db';
import { processImageForStorage } from '@/lib/r2';

export async function saveImage(adopterId: string, url: string, caption?: string, adoptionId?: string, mediaType?: string) {
    try {
        const db = await getDb();
        if (!db) throw new Error("No database");
        const addedBy = await getUser();

        const id = crypto.randomUUID();

        // Persist external URLs (Facebook CDN etc.) to R2 for permanent storage
        const persistedUrl = await processImageForStorage(url, adopterId, id);

        await db.insert(adopterImages).values({
            id,
            adopterId,
            adoptionId: adoptionId || null,
            url: persistedUrl,
            caption: caption || null,
            uploadedAt: new Date(),
            addedBy,
            mediaType: mediaType || 'image',
        });

        return { success: true, id };
    } catch (error) {
        console.error("Save image error:", error instanceof Error ? error.message : 'Unknown error');
        const errorId = logger.error('Save image failed', error, { adopterId });
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
        console.error("Get images error:", error);
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
        return { success: true };
    } catch (error) {
        console.error("Set profile picture error:", error);
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
        console.error("Get adoption images error:", error);
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
        console.error("Delete image error:", error);
        const errorId = logger.error('Delete image failed', error, { imageId, adopterId });
        throw new Error(`Failed to delete image (Error ID: ${errorId})`);
    }
}
