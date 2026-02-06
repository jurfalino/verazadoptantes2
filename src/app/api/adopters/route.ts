export const runtime = 'edge';

import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { createDb } from '@/db';
import { adopters, adopterFlags, adopterImages } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';

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
            // Fallback for local - handled by createDb usually but here we need env
            // If local dev without D1 binding, this might fail unless we use local fallback logic similar to actions.ts
            // But usually route handlers in Edge runtime need env.DB
            // For now assume D1 is bound as per standard setup
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
    const session = await auth();
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await request.json() as {
            name: string;
            contactInfo?: any;
            addressInfo?: any;
            notes?: string;
            sourceUrl?: string;
            flags?: string[];
            images?: Array<{ data: string; mimeType: string; originalUrl?: string }>;
        };
        const { name, contactInfo, addressInfo, notes, sourceUrl, flags, images } = body;

        const { env } = getRequestContext();
        if (!env?.DB) throw new Error('Database binding not found');
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

        // Safe insertion with only known fields
        await db.insert(adopters).values({
            id: newId,
            name,
            contactInfo: contactInfoStr || null,
            addressInfo: addressInfoStr || null,
            familyMembers: null, // Not extracted from FB usually specifically
            status: '5', // Default neutral/good
            addedBy: session.user.email || 'anonymous',
            sourceUrl: sourceUrl || null
        });

        // Add flags if any
        if (flags && Array.isArray(flags)) {
            for (const flagReason of flags) {
                await db.insert(adopterFlags).values({
                    id: crypto.randomUUID(),
                    adopterId: newId,
                    flaggedBy: 'system',
                    reason: flagReason,
                    createdAt: new Date()
                });
            }
        }

        // Save images if any
        if (images && Array.isArray(images) && images.length > 0) {
            for (let i = 0; i < images.length; i++) {
                const img = images[i];
                // Use original URL if available (from Playwright scraper), otherwise create data URL (from uploads)
                const imageUrl = img.originalUrl || `data:${img.mimeType};base64,${img.data}`;

                // Skip if data URL is too large (> 500KB base64 = ~375KB actual) - these shouldn't be stored
                if (imageUrl.startsWith('data:') && imageUrl.length > 500000) {
                    console.warn(`[Adopter Create] Skipping oversized image ${i + 1} (${imageUrl.length} chars)`);
                    continue;
                }

                await db.insert(adopterImages).values({
                    id: crypto.randomUUID(),
                    adopterId: newId,
                    url: imageUrl,
                    caption: `Imported from Facebook (${i + 1})`,
                    addedBy: session.user.email || 'anonymous',
                    isProfilePicture: i === 0 ? 1 : 0 // First image as profile picture
                });
            }
        }


        return NextResponse.json({ success: true, id: newId });

    } catch (error) {
        console.error('Create adopter failed:', error);
        return NextResponse.json({ error: 'Failed to create adopter' }, { status: 500 });
    }
}
