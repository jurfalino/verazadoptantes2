export const runtime = 'edge';

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { extractAdopterData } from '@/lib/gemini';
import { logger } from '@/lib/logger';
import { arrayBufferToBase64 } from '@/lib/base64';
import { getDb } from '@/lib/db';
import { appConfig } from '@/db/schema';
import { eq } from 'drizzle-orm';

/**
 * Read the admin-configured default Gemini model from app_config. Returns
 * `undefined` when not set (or on D1 read failure) so extractAdopterData's
 * baked-in default kicks in. Added v2.16.0-41 so the next Google retires
 * a model isn't a deploy — admins flip it in /admin/config.
 */
async function getDefaultModelFromConfig(): Promise<string | undefined> {
    try {
        const db = await getDb();
        if (!db) return undefined;
        const row = await db.select().from(appConfig)
            .where(eq(appConfig.key, 'GEMINI_DEFAULT_MODEL'))
            .get();
        const v = row?.value?.trim();
        return v ? v : undefined;
    } catch {
        return undefined;
    }
}

export async function POST(request: NextRequest) {
    let session: any = null;
    try {
        // Check auth
        session = await auth();

        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // v2.20.3: no ENABLE_CONTENT_IMPORT gate here. The flag is a homepage
        // VISIBILITY toggle only (hides the import CTA on the homepage); the
        // OS-share → /import → extract path is a deliberate second entry point
        // that must keep working when the homepage option is off. Gating this
        // route silently 403'd share-to-import. Auth above is the real gate.

        // Parse request
        const body = await request.json() as {
            text?: string;
            images?: Array<{ data: string; mimeType: string }>;
            imageUrls?: string[];
            model?: string;
            language?: string;
        };

        const { text, images, imageUrls } = body;

        // Validate input
        if (!text?.trim() && (!images || images.length === 0) && (!imageUrls || imageUrls.length === 0)) {
            return NextResponse.json({ error: 'No text or images provided' }, { status: 400 });
        }

        // Combine all images
        const allImages: Array<{ data: string; mimeType: string; originalUrl?: string }> = [];

        // Add uploaded images
        if (images) {
            allImages.push(...images.slice(0, 5));
        }

        // Download and add URL images
        if (imageUrls && imageUrls.length > 0) {
            const remainingSlots = 5 - allImages.length;
            const urlsToFetch = imageUrls.slice(0, remainingSlots);

            for (const url of urlsToFetch) {
                try {
                    const imgResponse = await fetch(url, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                        },
                    });

                    if (imgResponse.ok) {
                        const contentType = imgResponse.headers.get('content-type') || 'image/jpeg';
                        const buffer = await imgResponse.arrayBuffer();
                        const base64 = arrayBufferToBase64(buffer);
                        // Include original URL so it can be stored in DB instead of base64
                        allImages.push({ data: base64, mimeType: contentType, originalUrl: url });
                    } else {
                    }
                } catch (err) {
                    // Skip failed image downloads silently
                }
            }
        }


        logger.info('AI extraction started', {
            userEmail: session?.user?.email || 'anonymous',
            hasText: !!text?.trim(),
            imageCount: allImages.length,
        });

        // Precedence: explicit body.model (per-call override) → admin-set
        // default (DB) → baked-in default in extractAdopterData.
        const modelName = body.model || await getDefaultModelFromConfig();

        // Call Gemini API
        const extracted = await extractAdopterData(
            text,
            allImages.length > 0 ? allImages : undefined,
            modelName,
            body.language || 'es'
        );

        // Everything that shapes what the rescuer sees next — what was found and
        // what the AI says it could not read. Counts and codes only, no values.
        const issues = Array.isArray(extracted.extractionIssues) ? extracted.extractionIssues.filter(i => typeof i === 'string').slice(0, 10) : [];
        const completed = {
            userEmail: session?.user?.email || 'anonymous',
            confidence: extracted.confidence,
            extractionFailed: !!extracted.extractionFailed,
            extractionIssues: issues,
            hasName: !!extracted.name,
            phoneCount: extracted.phones?.length || 0,
            emailCount: extracted.emails?.length || 0,
            socialCount: extracted.socialProfiles?.length || 0,
            otherPeopleCount: Array.isArray(extracted.otherPeople) ? extracted.otherPeople.length : 0,
            ratingSuggested: typeof extracted.adoptionRating === 'number',
            imageCount: allImages.length,
        };
        if (extracted.extractionFailed || issues.length) logger.warn('AI extraction completed with issues', completed);
        else logger.info('AI extraction completed', completed);

        return NextResponse.json({
            success: true,
            data: extracted,
            // Return processed images so they can be saved with the profile
            processedImages: allImages,
        });

    } catch (error) {
        // logger.error already called below

        logger.error('AI extraction failed', error, { userEmail: session?.user?.email || 'anonymous' });

        return NextResponse.json({
            error: 'Extraction failed. Please try again.'
        }, { status: 500 });
    }
}

