export const runtime = 'edge';

import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { createDb } from '@/db';
import { adopters, adopterFlags, adopterImages, adoptions } from '@/db/schema';
import { eq, like, or, and, isNull } from 'drizzle-orm';
import { auth } from '@/auth';
import { logger, generateErrorId } from '@/lib/logger';

export async function GET(request: Request) {
    const session = await auth();
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const sourceUrl = searchParams.get('sourceUrl');
    const matchName = searchParams.get('matchName');
    const matchPhones = searchParams.get('matchPhones'); // comma-separated
    const matchAddresses = searchParams.get('matchAddresses'); // comma-separated

    if (!sourceUrl && !matchName && !matchPhones) {
        return NextResponse.json({ error: 'Missing search parameters' }, { status: 400 });
    }

    try {
        const { env } = getRequestContext();
        if (!env?.DB) {
            throw new Error('Database binding not found');
        }
        const db = await createDb(env.DB);

        // Mode 1: Exact URL match (same-post duplicate detection)
        if (sourceUrl) {
            const matches = await db.select()
                .from(adopters)
                .where(eq(adopters.sourceUrl, sourceUrl));
            return NextResponse.json({ matches, matchType: 'url' });
        }

        // Mode 2: Multi-field person matching (different post, same person)
        const phones = matchPhones ? matchPhones.split(',').map(p => p.trim()).filter(Boolean) : [];
        const addresses = matchAddresses ? matchAddresses.split(',').map(a => a.trim()).filter(Boolean) : [];

        // Build OR conditions for fuzzy matching
        const conditions = [];
        if (matchName) {
            conditions.push(like(adopters.name, `%${matchName}%`));
        }
        for (const phone of phones) {
            // Strip non-digits for more flexible matching
            const digitsOnly = phone.replace(/\D/g, '');
            if (digitsOnly.length >= 4) {
                conditions.push(like(adopters.contactInfo, `%${digitsOnly}%`));
            }
        }
        for (const addr of addresses) {
            if (addr.length >= 5) {
                conditions.push(like(adopters.contactInfo, `%${addr}%`));
            }
        }

        if (conditions.length === 0) {
            return NextResponse.json({ matches: [], matchType: 'person', confidence: 'none' });
        }

        const matches = await db.select()
            .from(adopters)
            .where(or(...conditions))
            .limit(5);

        if (matches.length === 0) {
            return NextResponse.json({ matches: [], matchType: 'person', confidence: 'none' });
        }

        // Score confidence for each match
        const scoredMatches = await Promise.all(matches.map(async (match) => {
            let confidence: 'high' | 'medium' | 'low' = 'low';
            const reasons: string[] = [];

            // Check name match
            const nameMatch = matchName && match.name?.toLowerCase().includes(matchName.toLowerCase());
            if (nameMatch) reasons.push('name');

            // Check phone match
            const phoneMatch = phones.some(phone => {
                const digits = phone.replace(/\D/g, '');
                return digits.length >= 4 && match.contactInfo?.includes(digits);
            });
            if (phoneMatch) reasons.push('phone');

            // Check address match
            const addrMatch = addresses.some(addr => {
                return addr.length >= 5 && match.contactInfo?.toLowerCase().includes(addr.toLowerCase());
            });
            if (addrMatch) reasons.push('address');

            // Determine confidence level
            if (phoneMatch && nameMatch) confidence = 'high';
            else if (phoneMatch) confidence = 'high';
            else if (nameMatch && addrMatch) confidence = 'medium';
            else if (nameMatch) confidence = 'medium';
            else if (addrMatch) confidence = 'low';

            // Fetch thumbnail for preview
            let thumbnail: string | null = null;
            try {
                const imgs = await db.select({ url: adopterImages.url })
                    .from(adopterImages)
                    .where(and(
                        eq(adopterImages.adopterId, match.id),
                        eq(adopterImages.isProfilePicture, 1),
                        isNull(adopterImages.adoptionId)
                    ))
                    .limit(1);
                if (imgs.length > 0) thumbnail = imgs[0].url;
            } catch (e) { console.warn('[adopters/route] Thumbnail fetch failed for', match.id, e); }

            return {
                ...match,
                thumbnail,
                confidence,
                matchReasons: reasons
            };
        }));

        // Sort by confidence (high first)
        const confidenceOrder = { high: 0, medium: 1, low: 2 };
        scoredMatches.sort((a, b) => confidenceOrder[a.confidence] - confidenceOrder[b.confidence]);

        return NextResponse.json({
            matches: scoredMatches,
            matchType: 'person',
            confidence: scoredMatches[0]?.confidence || 'none'
        });
    } catch (error) {
        console.error('Check duplicate/match failed:', error);
        logger.error('Adopter duplicate check failed', error, { sourceUrl: sourceUrl || undefined, matchName: matchName || undefined });
        return NextResponse.json({ matches: [], matchType: sourceUrl ? 'url' : 'person', confidence: 'none' });
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
        contactInfo?: string | { phones?: string[]; emails?: string[]; socialProfiles?: string[]; addresses?: string[] };
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

        // Format contact info — accept raw string or structured object
        let contactInfoStr = '';
        if (typeof contactInfo === 'string') {
            contactInfoStr = contactInfo;
        } else if (contactInfo) {
            const parts = [];
            if (contactInfo.phones?.length) parts.push(`Teléfonos: ${contactInfo.phones.join(', ')}`);
            if (contactInfo.emails?.length) parts.push(`Correos: ${contactInfo.emails.join(', ')}`);
            if (contactInfo.socialProfiles?.length) parts.push(`Redes sociales: ${contactInfo.socialProfiles.join(', ')}`);
            if (contactInfo.addresses?.length) parts.push(`Dirección: ${contactInfo.addresses.join(', ')}`);
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
            // Pack notes and contact info into details for searchability
            const detailsParts: string[] = [];
            if (notes) detailsParts.push(notes);
            if (contactInfoStr) detailsParts.push(`Contact: ${contactInfoStr}`);

            await db.insert(adoptions).values({
                id: crypto.randomUUID(),
                adopterId: newId,
                animalName: adoption.animalName || 'Unknown',
                species: adoption.species || 'other',
                status: 'completed',
                rating: adoption.rating || 2,
                addedBy: session.user.email || 'anonymous',
                recordType: adoption.recordType || 'adoption',
                date: adoption.date ? new Date(adoption.date) : new Date(),
                sourceUrl: sourceUrl || null,
                details: detailsParts.length > 0 ? detailsParts.join('\n') : null
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
