export const runtime = 'edge';

import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { createDb } from '@/db';
import { adopters, adopterFlags, adopterImages, adoptions } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { logger, generateErrorId } from '@/lib/logger';

export async function GET(request: Request) {
    const session = await auth();
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const sourceUrl = searchParams.get('sourceUrl');

    if (!sourceUrl) {
        return NextResponse.json({ error: 'Missing sourceUrl' }, { status: 400 });
    }

    try {
        const { env } = getRequestContext();
        if (!env?.DB) {
            throw new Error('Database binding not found');
        }
        const db = await createDb(env.DB);

        const matches = await db.select()
            .from(adopters)
            .where(eq(adopters.sourceUrl, sourceUrl));

        return NextResponse.json({ matches });
    } catch (error) {
        console.error('Check duplicate failed:', error);
        return NextResponse.json({ matches: [] }); // Fail safe to empty
    }
}

export async function POST(request: Request) {
    const errorId = generateErrorId();

    const session = await auth();
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: {
        name: string;
        contactInfo?: { phones?: string[]; emails?: string[]; socialProfiles?: string[]; addresses?: string[] };
        notes?: string;
        sourceUrl?: string;
        flags?: string[];
        images?: Array<{ data: string; mimeType: string; originalUrl?: string }>;
        adoption?: {
            animalName?: string;
            species?: string;
            recordType?: 'adoption' | 'returned_pet' | 'follow_up' | 'observation';
            rating?: number;
            date?: string; // YYYY-MM-DD format
        };
    };

    try {
        body = await request.json();
    } catch (parseError) {
        logger.error('Adopter create: failed to parse body', parseError, {
            errorId,
            user: session.user.email
        });
        return NextResponse.json({ error: 'Invalid JSON body', errorId }, { status: 400 });
    }

    const { name, contactInfo, notes, sourceUrl, flags, images, adoption } = body;

    // Log the incoming request (without image data for size)
    logger.info('Adopter create: start', {
        errorId,
        name,
        sourceUrl,
        hasContactInfo: !!contactInfo,
        flagCount: flags?.length || 0,
        imageCount: images?.length || 0,
        user: session.user.email
    });

    try {
        const { env } = getRequestContext();
        if (!env?.DB) {
            logger.error('Adopter create: DB binding not found', undefined, { errorId, user: session.user.email });
            throw new Error('Database binding not found');
        }
        const db = await createDb(env.DB);

        // Format contact info as a readable string since schema stores it as text blob
        let contactInfoStr = '';
        if (contactInfo) {
            const parts = [];
            if (contactInfo.phones?.length) parts.push(`Phones: ${contactInfo.phones.join(', ')}`);
            if (contactInfo.emails?.length) parts.push(`Emails: ${contactInfo.emails.join(', ')}`);
            if (contactInfo.socialProfiles?.length) parts.push(`Socials: ${contactInfo.socialProfiles.join(', ')}`);
            if (contactInfo.addresses?.length) parts.push(`Dirección / Address: ${contactInfo.addresses.join(', ')}`);
            contactInfoStr = parts.join('\n');
        }



        const newId = crypto.randomUUID();

        // Insert adopter record
        await db.insert(adopters).values({
            id: newId,
            name,
            contactInfo: contactInfoStr || null,
            notes: notes || null,
            familyMembers: null,
            status: '5', // Default neutral/good
            addedBy: session.user.email || 'anonymous',
            sourceUrl: sourceUrl || null
            // createdAt and updatedAt use database defaults
        });

        // Add flags if any (don't pass createdAt, let DB default handle it)
        if (flags && Array.isArray(flags) && flags.length > 0) {
            for (const flagReason of flags) {
                await db.insert(adopterFlags).values({
                    id: crypto.randomUUID(),
                    adopterId: newId,
                    flaggedBy: 'system',
                    reason: flagReason
                    // createdAt uses database default
                });
            }
        }

        // Save images if any
        let savedImageCount = 0;
        if (images && Array.isArray(images) && images.length > 0) {
            for (let i = 0; i < images.length; i++) {
                const img = images[i];
                // Use original URL if available (from Playwright scraper), otherwise create data URL (from uploads)
                const imageUrl = img.originalUrl || `data:${img.mimeType};base64,${img.data}`;

                // Skip if data URL is too large (>500KB base64 = ~375KB actual) - these shouldn't be stored
                if (imageUrl.startsWith('data:') && imageUrl.length > 500000) {
                    logger.warn('Adopter create: skipping oversized image', {
                        errorId,
                        index: i,
                        size: imageUrl.length,
                        user: session.user.email
                    });
                    continue;
                }

                await db.insert(adopterImages).values({
                    id: crypto.randomUUID(),
                    adopterId: newId,
                    url: imageUrl,
                    caption: `Imported from Facebook (${i + 1})`,
                    addedBy: session.user.email || 'anonymous',
                    isProfilePicture: i === 0 ? 1 : 0 // First image as profile picture
                    // uploadedAt uses database default
                });
                savedImageCount++;
            }
        }

        // Create adoption record if adoption data provided
        if (adoption && (adoption.animalName || adoption.species)) {
            await db.insert(adoptions).values({
                id: crypto.randomUUID(),
                adopterId: newId,
                animalName: adoption.animalName || 'Unknown',
                species: adoption.species || 'other',
                status: 'completed',
                rating: adoption.rating || 2,
                addedBy: session.user.email || 'anonymous',
                recordType: adoption.recordType || 'adoption',
                date: adoption.date ? new Date(adoption.date) : new Date()
            });
            logger.info('Adopter create: adoption record created', {
                errorId,
                adopterId: newId,
                user: session.user.email
            });
        }

        logger.info('Adopter create: complete', {
            errorId,
            adopterId: newId,
            flagCount: flags?.length || 0,
            imageCount: savedImageCount,
            hasAdoption: !!adoption,
            user: session.user.email
        });

        return NextResponse.json({ success: true, id: newId });

    } catch (error) {
        const loggedErrorId = logger.error('Adopter create: failed', error, {
            originalErrorId: errorId,
            name,
            sourceUrl,
            user: session.user.email
        });

        return NextResponse.json({
            error: 'Failed to create adopter',
            errorId: loggedErrorId
        }, { status: 500 });
    }
}
