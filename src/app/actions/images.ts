'use server';

import { adopterImages, adopterHistory, adopters } from '@/db/schema';
import { eq, sql, and, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { getDb, getUser } from './_db';
import { processImageForStorage } from '@/lib/r2';

/**
 * v2.26.2: changing an adopter's PROFILE PHOTO (setting an existing image as the
 * avatar, or uploading a new one AS the avatar) is gated the same as editing the
 * record's contact info: owner ∨ admin ∨ org-mate. This mirrors saveAdopter's
 * `canEditAdopterRecord({ gatingEnabled: true, ... })` call — the gate is always
 * enforced, independent of the PII feature flag. Contributing a gallery photo
 * (isProfilePicture false) stays OPEN; only the record-identity change is gated.
 * Throws with a clear message when the actor isn't permitted.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertCanChangeProfilePhoto(db: any, adopterId: string, actor: string): Promise<void> {
    const ownerRow = await db.select({ addedBy: adopters.addedBy })
        .from(adopters).where(eq(adopters.id, adopterId)).get();
    const ownerEmail: string | null = ownerRow?.addedBy ?? null;
    const [{ canEditAdopterRecord }, { isAdminAsync }, { isOrgMate }] = await Promise.all([
        import('@/lib/piiAccess'),
        import('@/config/admins'),
        import('@/lib/orgMembership'),
    ]);
    const [actorIsAdmin, actorIsOrgMate] = await Promise.all([
        isAdminAsync(actor),
        isOrgMate(actor, ownerEmail),
    ]);
    if (!canEditAdopterRecord({ gatingEnabled: true, actorEmail: actor, ownerEmail, actorIsAdmin, actorIsOrgMate })) {
        logger.warn('changeProfilePhoto: blocked — not owner/admin/org-mate', { adopterId, actor });
        throw new Error('Not authorized to change this adopter\'s profile photo.');
    }
}

export async function saveImage(adopterId: string, url: string, caption?: string, adoptionId?: string, mediaType?: string, isProfilePicture?: boolean) {
    const db = await getDb();
    if (!db) throw new Error("No database");
    const addedBy = await getUser();
    // v2.26.2: uploading a NEW image AS the avatar is a profile-photo change —
    // gate it (owner ∨ admin ∨ org-mate). Plain gallery uploads stay open.
    if (isProfilePicture) {
        await assertCanChangeProfilePhoto(db, adopterId, addedBy);
    }
    try {
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

        // v2.19.5: audit row so /admin/audit surfaces image uploads alongside
        // every other "what the user did" event. Previously this was a
        // coverage gap — adopter pages logged adopter_updated for the
        // record edit but image uploads went unrecorded in audit_log.
        logAudit({
            userEmail: addedBy,
            action: 'image_uploaded',
            target: adopterId,
            details: {
                adopterId,
                mediaType: mediaType || 'image',
                isProfilePicture: !!isProfilePicture,
            },
        });

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

/**
 * v2.26.1: ALL images for an adopter — profile-level AND activity-linked
 * (attached to an adoption/observation record). Ordered so the profile picture
 * (is_profile_picture=1, wherever it's attached) sorts first.
 *
 * Feeds the profile-page avatar + the profile-photo chooser, so an observation
 * photo can be promoted to the avatar. The Photos GALLERY keeps using getImages
 * (profile-level only) — this must NOT replace it there, or activity photos
 * would be duplicated into the gallery with its own delete/edit actions.
 */
export async function getAllAdopterImages(adopterId: string) {
    try {
        const db = await getDb();
        if (!db) return [];
        return await db.select().from(adopterImages)
            .where(eq(adopterImages.adopterId, adopterId))
            .orderBy(sql`${adopterImages.isProfilePicture} DESC, ${adopterImages.uploadedAt} DESC`)
            .all();
    } catch (error) {
        logger.error('Get all adopter images failed', error, { adopterId });
        return [];
    }
}

export async function setProfilePicture(adopterId: string, imageId: string) {
    const db = await getDb();
    if (!db) throw new Error("No database");
    // v2.26.2: gate profile-photo change (owner ∨ admin ∨ org-mate). getUser
    // throws for anonymous; the assert throws for a non-editor. Both propagate
    // cleanly (outside the try) rather than being masked as a generic failure.
    const actor = await getUser();
    await assertCanChangeProfilePhoto(db, adopterId, actor);
    try {
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

        // v2.19.5: audit row — companion to image_uploaded so the timeline
        // shows "X set Y as profile picture" separately from initial upload.
        // Reuses the `actor` resolved for the auth gate above.
        try {
            logAudit({
                userEmail: actor,
                action: 'profile_picture_set',
                target: adopterId,
                details: { imageId },
            });
        } catch (e) {
            logger.warn('setProfilePicture: audit log failed', {
                adopterId, imageId,
                error: e instanceof Error ? e.message : String(e),
            });
        }

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

        // v2.19.68: previously UNGUARDED — any authenticated user could delete
        // any image. Gate to the uploader OR an admin, matching the UI
        // (ImageGallery shows delete only when isAdmin || addedBy === currentUser).
        const { isAdminAsync } = await import('@/config/admins');
        if (existing.addedBy !== changedBy && !await isAdminAsync(changedBy)) {
            throw new Error("Not authorized to delete this image");
        }

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
