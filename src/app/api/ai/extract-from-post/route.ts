export const runtime = 'edge';

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { extractAdopterData } from '@/lib/gemini';
import { getFeatureFlag } from '@/config/features';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
    let session: any = null;
    try {
        // Check auth
        session = await auth();

        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Check feature flag
        const isEnabled = await getFeatureFlag('ENABLE_CONTENT_IMPORT');
        if (!isEnabled) {
            return NextResponse.json({ error: 'Feature not enabled' }, { status: 403 });
        }

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
                        const base64 = btoa(
                            new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
                        );
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

        // Call Gemini API
        const extracted = await extractAdopterData(
            text,
            allImages.length > 0 ? allImages : undefined,
            body.model || undefined,
            body.language || 'es'
        );

        logger.info('AI extraction completed', {
            userEmail: session?.user?.email || 'anonymous',
            confidence: extracted.confidence,
            hasName: !!extracted.name,
            phoneCount: extracted.phones?.length || 0,
        });

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

