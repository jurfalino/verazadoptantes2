export const runtime = 'edge';

import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { createDb } from '@/db';
import { adopters, adopterFlags, adopterImages } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { logEvent } from '@/lib/axiom';

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
    const errorId = crypto.randomUUID().slice(0, 8);

    const session = await auth();
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: {
        name: string;
        contactInfo?: { phones?: string[]; emails?: string[]; socialProfiles?: string[] };
        addressInfo?: { addresses?: string[] };
        notes?: string;
        sourceUrl?: string;
        flags?: string[];
        images?: Array<{ data: string; mimeType: string; originalUrl?: string }>;
    };

    try {
        body = await request.json();
    } catch (parseError) {
        await logEvent('adopter_create_error', {
            errorId,
            phase: 'parse_body',
            error: String(parseError),
            user: session.user.email
        });
        return NextResponse.json({ error: 'Invalid JSON body', errorId }, { status: 400 });
    }

    const { name, contactInfo, addressInfo, notes, sourceUrl, flags, images } = body;

    // Log the incoming request (without image data for size)
    await logEvent('adopter_create', {
        errorId,
        phase: 'start',
        name,
        sourceUrl,
        hasContactInfo: !!contactInfo,
        hasAddressInfo: !!addressInfo,
        flagCount: flags?.length || 0,
        imageCount: images?.length || 0,
        user: session.user.email
    });

    try {
        const { env } = getRequestContext();
        if (!env?.DB) {
            await logEvent('adopter_create_error', {
                errorId,
                phase: 'db_binding',
                error: 'Database binding not found',
                user: session.user.email
            });
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
            contactInfoStr = parts.join('\n');
        }

        // Append notes to contact info if present
        if (notes) {
            contactInfoStr = contactInfoStr ? `${contactInfoStr}\n\nNotes:\n${notes}` : `Notes:\n${notes}`;
        }

        // Format address info
        let addressInfoStr = '';
        if (addressInfo && addressInfo.addresses?.length) {
            addressInfoStr = addressInfo.addresses.join('\n');
        }

        const newId = crypto.randomUUID();

        // Insert adopter record
        await logEvent('adopter_create', { errorId, phase: 'inserting_adopter', adopterId: newId });

        await db.insert(adopters).values({
            id: newId,
            name,
            contactInfo: contactInfoStr || null,
            addressInfo: addressInfoStr || null,
            familyMembers: null,
            status: '5', // Default neutral/good
            addedBy: session.user.email || 'anonymous',
            sourceUrl: sourceUrl || null
            // createdAt and updatedAt use database defaults
        });

        // Add flags if any (don't pass createdAt, let DB default handle it)
        if (flags && Array.isArray(flags) && flags.length > 0) {
            await logEvent('adopter_create', { errorId, phase: 'inserting_flags', count: flags.length });

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
        if (images && Array.isArray(images) && images.length > 0) {
            await logEvent('adopter_create', { errorId, phase: 'inserting_images', count: images.length });

            let savedCount = 0;
            for (let i = 0; i < images.length; i++) {
                const img = images[i];
                // Use original URL if available (from Playwright scraper), otherwise create data URL (from uploads)
                const imageUrl = img.originalUrl || `data:${img.mimeType};base64,${img.data}`;

                // Skip if data URL is too large (>500KB base64 = ~375KB actual) - these shouldn't be stored
                if (imageUrl.startsWith('data:') && imageUrl.length > 500000) {
                    await logEvent('adopter_create', {
                        errorId,
                        phase: 'skipping_large_image',
                        index: i,
                        size: imageUrl.length
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
                savedCount++;
            }

            await logEvent('adopter_create', { errorId, phase: 'images_saved', count: savedCount });
        }

        await logEvent('adopter_create', {
            errorId,
            phase: 'complete',
            adopterId: newId,
            user: session.user.email
        });

        return NextResponse.json({ success: true, id: newId });

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;

        await logEvent('adopter_create_error', {
            errorId,
            phase: 'db_operation',
            error: errorMessage,
            stack: errorStack?.slice(0, 500), // Truncate stack trace
            name,
            sourceUrl,
            user: session.user.email
        });

        console.error(`[Adopter Create] Error ${errorId}:`, error);
        return NextResponse.json({
            error: 'Failed to create adopter',
            errorId
        }, { status: 500 });
    }
}
