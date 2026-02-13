export const runtime = 'edge';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { adopters, adoptions, adopterImages, adopterFlags, adopterHistory, adopterStats, duplicateCandidates, duplicateTokens, auditLog } from '@/db/schema';
import { eq, or, and } from 'drizzle-orm';
import { auth } from '@/auth';
import { isAdmin } from '@/config/admins';
import { logger } from '@/lib/logger';

/**
 * POST /api/admin/duplicates/merge
 * Merge two adopter profiles: move records to primary, soft-delete secondary
 */
export async function POST(request: Request) {
    const session = await auth();
    if (!session?.user?.email || !isAdmin(session.user.email)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { primaryId, secondaryId } = await request.json() as { primaryId: string; secondaryId: string };

        if (!primaryId || !secondaryId || primaryId === secondaryId) {
            return NextResponse.json({ error: 'Invalid merge request' }, { status: 400 });
        }

        const db = await getDb();
        if (!db) throw new Error('Database not available');

        // Fetch both profiles
        const [primary, secondary] = await Promise.all([
            db.select().from(adopters).where(eq(adopters.id, primaryId)).get(),
            db.select().from(adopters).where(eq(adopters.id, secondaryId)).get(),
        ]);

        if (!primary || !secondary) {
            return NextResponse.json({ error: 'One or both adopters not found' }, { status: 404 });
        }

        if (primary.deletedAt || secondary.deletedAt) {
            return NextResponse.json({ error: 'Cannot merge already-deleted profiles' }, { status: 400 });
        }

        // Track what we're moving
        const mergeDetails: Record<string, number> = {};

        // 1. Re-point adoptions
        const movedAdoptions = await db.update(adoptions)
            .set({ adopterId: primaryId })
            .where(eq(adoptions.adopterId, secondaryId));
        mergeDetails.adoptions = movedAdoptions?.rowsAffected || 0;

        // 2. Re-point images
        const movedImages = await db.update(adopterImages)
            .set({ adopterId: primaryId })
            .where(eq(adopterImages.adopterId, secondaryId));
        mergeDetails.images = movedImages?.rowsAffected || 0;

        // 3. Re-point flags (except the duplicate flag between these two)
        await db.update(adopterFlags)
            .set({ adopterId: primaryId })
            .where(and(
                eq(adopterFlags.adopterId, secondaryId),
            ));

        // 4. Re-point history
        await db.update(adopterHistory)
            .set({ adopterId: primaryId })
            .where(eq(adopterHistory.adopterId, secondaryId));

        // 5. Re-point stats
        await db.update(adopterStats)
            .set({ adopterId: primaryId })
            .where(eq(adopterStats.adopterId, secondaryId));

        // 6. Merge text fields (append secondary data if primary lacks it)
        const updates: Partial<typeof adopters.$inferInsert> = {};

        if (secondary.contactInfo) {
            updates.contactInfo = primary.contactInfo
                ? `${primary.contactInfo}\n--- Merged from ${secondary.name} ---\n${secondary.contactInfo}`
                : secondary.contactInfo;
        }

        if (secondary.addressInfo && !primary.addressInfo) {
            updates.addressInfo = secondary.addressInfo;
        } else if (secondary.addressInfo && primary.addressInfo) {
            updates.addressInfo = `${primary.addressInfo}\n--- Merged ---\n${secondary.addressInfo}`;
        }

        if (secondary.familyMembers) {
            updates.familyMembers = primary.familyMembers
                ? `${primary.familyMembers}\n${secondary.familyMembers}`
                : secondary.familyMembers;
        }

        if (secondary.notes) {
            updates.notes = primary.notes
                ? `${primary.notes}\n--- Merged from ${secondary.name} ---\n${secondary.notes}`
                : secondary.notes;
        }

        // Source URL: keep if primary doesn't have one
        if (secondary.sourceUrl && !primary.sourceUrl) {
            updates.sourceUrl = secondary.sourceUrl;
        }

        // Clear tokenHash to force re-tokenization
        updates.tokenHash = null;
        updates.updatedAt = new Date();

        if (Object.keys(updates).length > 0) {
            await db.update(adopters).set(updates).where(eq(adopters.id, primaryId));
        }

        // 7. Soft-delete secondary
        await db.update(adopters).set({
            deletedAt: new Date(),
            tokenHash: 'MERGED',
        }).where(eq(adopters.id, secondaryId));

        // 8. Clean up tokens for secondary
        await db.delete(duplicateTokens).where(eq(duplicateTokens.adopterId, secondaryId));

        // 9. Mark duplicate candidates involving both as 'merged'
        const candidateConditions = or(
            and(eq(duplicateCandidates.adopter1Id, primaryId), eq(duplicateCandidates.adopter2Id, secondaryId)),
            and(eq(duplicateCandidates.adopter1Id, secondaryId), eq(duplicateCandidates.adopter2Id, primaryId)),
        );
        if (candidateConditions) {
            await db.update(duplicateCandidates).set({
                status: 'merged',
                resolvedAt: new Date(),
                resolvedBy: session.user.email,
            }).where(candidateConditions);
        }

        // Also dismiss any user flags between these two
        await db.update(adopterFlags).set({
            // We can't update "status" on flags since there isn't one,
            // but we add details to mark as resolved
            details: `Merged into ${primaryId} by ${session.user.email}`,
        }).where(and(
            eq(adopterFlags.reason, 'duplicate'),
            or(
                and(eq(adopterFlags.adopterId, primaryId), eq(adopterFlags.targetAdopterId, secondaryId)),
                and(eq(adopterFlags.adopterId, secondaryId), eq(adopterFlags.targetAdopterId, primaryId)),
            )
        ));

        // 10. Audit log
        await db.insert(auditLog).values({
            id: crypto.randomUUID(),
            userId: session.user.email,
            userEmail: session.user.email,
            action: 'adopter_merge',
            target: primaryId,
            details: JSON.stringify({
                primaryId,
                secondaryId,
                secondaryName: secondary.name,
                mergeDetails,
            }),
            createdAt: new Date(),
        });

        logger.info('Adopter merge complete', {
            primaryId,
            secondaryId,
            user: session.user.email,
            mergeDetails,
        });

        return NextResponse.json({
            success: true,
            primaryId,
            secondaryId,
            mergeDetails,
        });
    } catch (error) {
        logger.error('Adopter merge failed', error);
        return NextResponse.json({ error: 'Merge failed' }, { status: 500 });
    }
}
