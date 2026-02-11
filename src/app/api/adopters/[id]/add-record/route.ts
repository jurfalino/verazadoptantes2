export const runtime = 'edge';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { adopters, adopterImages, adoptions } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { logger, generateErrorId } from '@/lib/logger';

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const errorId = generateErrorId();
    const { id: adopterId } = await params;

    const session = await auth();
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: {
        sourceUrl?: string;
        notes?: string;
        contactInfo?: string;
        adoption: {
            animalName?: string;
            species?: string;
            recordType?: 'adoption' | 'returned_pet' | 'follow_up' | 'observation' | 'request';
            rating?: number;
            date?: string;
        };
        images?: Array<{ data: string; mimeType: string; originalUrl?: string }>;
    };

    try {
        body = await request.json();
    } catch (parseError) {
        logger.error('Add record: failed to parse body', parseError, { errorId, adopterId, user: session.user.email });
        return NextResponse.json({ error: 'Invalid JSON body', errorId }, { status: 400 });
    }

    const { sourceUrl, notes, contactInfo, adoption, images } = body;

    if (!adoption) {
        return NextResponse.json({ error: 'Missing adoption data', errorId }, { status: 400 });
    }

    logger.info('Add record: start', {
        errorId,
        adopterId,
        sourceUrl,
        recordType: adoption.recordType,
        user: session.user.email
    });

    try {
        const db = await getDb();
        if (!db) throw new Error('Database not available');

        // Verify adopter exists
        const existingAdopter = await db.select({ id: adopters.id, name: adopters.name })
            .from(adopters)
            .where(eq(adopters.id, adopterId))
            .get();

        if (!existingAdopter) {
            return NextResponse.json({ error: 'Adopter not found', errorId }, { status: 404 });
        }

        // Pack all extracted info into details
        const detailsParts: string[] = [];
        if (notes) detailsParts.push(notes);
        if (contactInfo) detailsParts.push(`Contact: ${contactInfo}`);
        if (sourceUrl) detailsParts.push(`Source: ${sourceUrl}`);

        // Create the adoption/observation/follow-up record
        const adoptionId = crypto.randomUUID();
        await db.insert(adoptions).values({
            id: adoptionId,
            adopterId,
            animalName: adoption.animalName || 'Unknown',
            species: adoption.species || 'other',
            status: 'completed',
            rating: adoption.rating || 2,
            addedBy: session.user.email || 'anonymous',
            recordType: adoption.recordType || 'observation',
            date: adoption.date ? new Date(adoption.date) : new Date(),
            sourceUrl: sourceUrl || null,
            details: detailsParts.length > 0 ? detailsParts.join('\n') : null
        });

        // Save images linked to both adopter and adoption record
        let savedImageCount = 0;
        if (images && Array.isArray(images) && images.length > 0) {
            for (let i = 0; i < images.length; i++) {
                const img = images[i];
                const imageUrl = img.originalUrl || `data:${img.mimeType};base64,${img.data}`;

                // Skip oversized data URLs
                if (imageUrl.startsWith('data:') && imageUrl.length > 500000) {
                    logger.warn('Add record: skipping oversized image', {
                        errorId, index: i, size: imageUrl.length, user: session.user.email
                    });
                    continue;
                }

                await db.insert(adopterImages).values({
                    id: crypto.randomUUID(),
                    adopterId,
                    adoptionId,
                    url: imageUrl,
                    caption: `Imported from Facebook (${i + 1})`,
                    addedBy: session.user.email || 'anonymous',
                    isProfilePicture: 0
                });
                savedImageCount++;
            }
        }

        logger.info('Add record: complete', {
            errorId,
            adopterId,
            adoptionId,
            recordType: adoption.recordType,
            imageCount: savedImageCount,
            user: session.user.email
        });

        return NextResponse.json({
            success: true,
            adoptionId,
            adopterId,
            adopterName: existingAdopter.name
        });

    } catch (error) {
        const loggedErrorId = logger.error('Add record: failed', error, {
            originalErrorId: errorId,
            adopterId,
            user: session.user.email
        });

        return NextResponse.json({
            error: 'Failed to add record',
            errorId: loggedErrorId
        }, { status: 500 });
    }
}
