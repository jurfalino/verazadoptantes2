export const runtime = 'edge';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { adopterImages } from '@/db/schema';
import { auth } from '@/auth';
import { logger } from '@/lib/logger';
import { uploadToR2 } from '@/lib/r2';

/**
 * POST /api/upload-media
 * 
 * Handles video (and image) file uploads via FormData.
 * Videos are uploaded directly to R2 — they're too large for server actions or D1 storage.
 * 
 * FormData fields:
 * - file: the media file
 * - adopterId: required
 * - adoptionId: optional
 * - caption: optional
 * - mediaType: 'video' | 'image'
 */
export async function POST(request: Request) {
    const session = await auth();
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const formData = await request.formData();
        const file = formData.get('file') as File | null;
        const adopterId = formData.get('adopterId') as string | null;
        const adoptionId = formData.get('adoptionId') as string | null;
        const caption = formData.get('caption') as string | null;
        const mediaType = formData.get('mediaType') as string || 'image';

        if (!file || !adopterId) {
            return NextResponse.json({ error: 'Missing file or adopterId' }, { status: 400 });
        }

        // Size limit: 50MB
        if (file.size > 50 * 1024 * 1024) {
            return NextResponse.json({ error: 'File too large (max 50MB)' }, { status: 413 });
        }

        const imageId = crypto.randomUUID();
        const ext = getFileExtension(file.type, file.name);
        const key = `adopters/${adopterId}/${imageId}.${ext}`;

        // Upload to R2
        const arrayBuffer = await file.arrayBuffer();
        const r2Url = await uploadToR2(key, arrayBuffer, file.type);

        // Upload thumbnail if provided (video uploads — sent as a File blob from client)
        let thumbnailUrl: string | null = null;
        const thumbnailFile = formData.get('thumbnail');
        if (thumbnailFile && thumbnailFile instanceof Blob && thumbnailFile.size > 0) {
            try {
                const thumbArrayBuffer = await thumbnailFile.arrayBuffer();
                const thumbKey = `adopters/${adopterId}/${imageId}_thumb.jpg`;
                console.log(`[upload-media] Uploading thumbnail: ${thumbKey} (${thumbArrayBuffer.byteLength} bytes, type: ${thumbnailFile.type})`);
                thumbnailUrl = await uploadToR2(thumbKey, thumbArrayBuffer, thumbnailFile.type || 'image/jpeg');
                console.log(`[upload-media] Thumbnail uploaded: ${thumbnailUrl}`);
            } catch (e) {
                console.warn('[upload-media] Thumbnail upload failed:', (e as Error).message);
            }
        }

        console.log(`[upload-media] Uploaded ${mediaType}: ${key} (${Math.round(file.size / 1024)}KB)${thumbnailUrl ? ' +thumb' : ''}`);

        // Save record to DB
        const db = await getDb();
        if (!db) throw new Error('Database not available');

        await db.insert(adopterImages).values({
            id: imageId,
            adopterId,
            adoptionId: adoptionId || null,
            url: r2Url,
            caption: caption || (mediaType === 'video' ? 'Uploaded Video' : 'Uploaded Image'),
            addedBy: session.user.email || 'anonymous',
            mediaType: mediaType === 'video' ? 'video' : 'image',
            isProfilePicture: 0,
            thumbnailUrl,
        });

        return NextResponse.json({ success: true, id: imageId, url: r2Url });
    } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        logger.error('Upload media failed', error, {});
        console.error('[upload-media] Error:', msg);
        return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
    }
}

function getFileExtension(mimeType: string, filename: string): string {
    const mimeMap: Record<string, string> = {
        'video/mp4': 'mp4',
        'video/webm': 'webm',
        'video/quicktime': 'mov',
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/gif': 'gif',
    };
    if (mimeMap[mimeType]) return mimeMap[mimeType];
    const ext = filename.split('.').pop()?.toLowerCase();
    if (ext && ext.length <= 4) return ext;
    return mimeType.startsWith('video/') ? 'mp4' : 'jpg';
}
