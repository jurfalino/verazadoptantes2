export const runtime = 'edge';

/**
 * «Cargar un animal desde un post» (Jon 2026-11-14): read an adoption post into
 * the animal form. Same shape as /api/ai/extract-from-post (the person
 * import): the post's images are downloaded here, the AI reads them with the
 * text, and every image comes back so the page can save the ones the rescuer
 * keeps. The AI's answer is coerced by `parseAnimalExtraction` — this route
 * never returns a field the form cannot take.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { extractAnimalsFromPost } from '@/lib/gemini';
import { logger } from '@/lib/logger';
import { arrayBufferToBase64 } from '@/lib/base64';
import { getDb } from '@/lib/db';
import { appConfig } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { parseAnimalExtraction } from '@/domain/animalImport';

/** The AI sees more photos than in the person import: telling a litter apart needs them. */
const MAX_AI_IMAGES = 10;
/** The page's own cap on a post's images. */
const MAX_IMAGES = 12;
/** One post image larger than this is not a photo worth reading — and would cost the Worker its memory. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function defaultModel(userEmail: string): Promise<string | undefined> {
    try {
        const db = await getDb();
        if (!db) return undefined;
        const row = await db.select().from(appConfig).where(eq(appConfig.key, 'GEMINI_DEFAULT_MODEL')).get();
        return row?.value?.trim() || undefined;
    } catch (e) {
        logger.warn('extract-animals: model setting not read, using the default', { userEmail, error: e instanceof Error ? e.message : String(e) });
        return undefined;
    }
}

export async function POST(request: NextRequest) {
    let userEmail = 'anonymous';
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        userEmail = session.user.email || 'anonymous';

        const body = await request.json() as {
            text?: string;
            images?: Array<{ data: string; mimeType: string }>;
            imageUrls?: string[];
            language?: string;
        };
        const text = typeof body.text === 'string' ? body.text.slice(0, 20000) : '';
        const uploads = Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : [];
        const urls = Array.isArray(body.imageUrls)
            ? body.imageUrls.filter(u => typeof u === 'string' && /^https:\/\//i.test(u)).slice(0, Math.max(0, MAX_IMAGES - uploads.length))
            : [];
        if (!text.trim() && uploads.length === 0 && urls.length === 0) {
            return NextResponse.json({ error: 'No text or images provided' }, { status: 400 });
        }

        const all: Array<{ data: string; mimeType: string; originalUrl?: string }> = uploads
            .filter(i => typeof i?.data === 'string' && typeof i?.mimeType === 'string' && i.mimeType.startsWith('image/'));
        let missingImages = 0;
        const fetched = await Promise.all(urls.map(async (url) => {
            try {
                const res = await fetch(url, { headers: { 'User-Agent': UA } });
                const type = res.headers.get('content-type') || 'image/jpeg';
                const declared = Number(res.headers.get('content-length') || 0);
                if (res.ok && type.startsWith('image/') && declared <= MAX_IMAGE_BYTES) {
                    const buf = await res.arrayBuffer();
                    if (buf.byteLength <= MAX_IMAGE_BYTES) return { data: arrayBufferToBase64(buf), mimeType: type, originalUrl: url };
                    logger.warn('extract-animals: post image too large', { userEmail, bytes: buf.byteLength });
                    return null;
                }
                logger.warn('extract-animals: post image not downloaded', { userEmail, status: res.status, type });
            } catch (e) {
                logger.warn('extract-animals: post image not downloaded', { userEmail, error: e instanceof Error ? e.message : String(e) });
            }
            return null;
        }));
        for (const img of fetched) { if (img) all.push(img); else missingImages++; }

        const aiImages = all.slice(0, MAX_AI_IMAGES).map(({ data, mimeType }) => ({ data, mimeType }));
        const language = ['es', 'en', 'pt'].includes(body.language ?? '') ? body.language! : 'es';
        logger.info('extract-animals started', { userEmail, hasText: !!text.trim(), imageCount: aiImages.length, savedImageCount: all.length, missingImages });

        const result = await extractAnimalsFromPost(text, aiImages, await defaultModel(userEmail), language);
        if (result.failed) {
            logger.warn('extract-animals: the AI could not read the post', { userEmail, imageCount: aiImages.length, reason: result.reason.slice(0, 200) });
            return NextResponse.json({ success: false, extractionFailed: true, processedImages: all, missingImages });
        }
        const data = parseAnimalExtraction(result.raw, all.length);
        logger.info('extract-animals completed', {
            userEmail,
            animals: data.animals.length,
            withName: data.animals.filter(a => a.name).length,
            withAge: data.animals.filter(a => a.ageValue).length,
            withSex: data.animals.filter(a => a.sex).length,
            withNeutered: data.animals.filter(a => a.neutered).length,
            hasPostDate: !!data.postDate,
            imageCount: aiImages.length,
        });
        return NextResponse.json({ success: true, data, processedImages: all, missingImages });
    } catch (error) {
        const errorId = logger.error('extract-animals failed', error, { userEmail });
        return NextResponse.json({ error: 'Extraction failed. Please try again.', errorId }, { status: 500 });
    }
}
