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

        // Size limit: 50MB for video, 10MB for images
        const maxSize = mediaType === 'video' ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
        if (file.size > maxSize) {
            return NextResponse.json({ error: `File too large (max ${mediaType === 'video' ? '50MB' : '10MB'})` }, { status: 413 });
        }

        // Validate file content via magic bytes — prevents executable uploads disguised as images
        const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
        if (!isAllowedMediaType(header)) {
            return NextResponse.json({ error: 'Invalid file type. Only images and videos are allowed.' }, { status: 415 });
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
        const errorId = logger.error('Upload media failed', error, {});
        return NextResponse.json({ error: 'Upload failed', errorId }, { status: 500 });
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

/**
 * Validate file content via magic bytes.
 * Prevents uploading executables (EXE, ELF, scripts) disguised as images.
 */
function isAllowedMediaType(header: Uint8Array): boolean {
    if (header.length < 4) return false;

    // JPEG: FF D8 FF
    if (header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF) return true;
    // PNG: 89 50 4E 47
    if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47) return true;
    // GIF: 47 49 46 38
    if (header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x38) return true;
    // WebP: RIFF....WEBP
    if (header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46 &&
        header.length >= 12 && header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50) return true;
    // MP4/MOV: ....ftyp (offset 4)
    if (header.length >= 8 && header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70) return true;
    // WebM/MKV: 1A 45 DF A3
    if (header[0] === 0x1A && header[1] === 0x45 && header[2] === 0xDF && header[3] === 0xA3) return true;

    return false;
}

