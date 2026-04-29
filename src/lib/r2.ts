/**
 * R2 Media Storage Helper
 * 
 * Downloads external images and videos and uploads them to Cloudflare R2 for permanent storage.
 * This solves the problem of social media CDN URLs expiring after a few days/weeks.
 */

import { getRequestContext } from '@cloudflare/next-on-pages';
import { logger } from '@/lib/logger';

const R2_PUBLIC_URL = 'https://pub-bb28dd8b1e674fc189252b0000a7b573.r2.dev';

const ALLOWED_DOMAINS = [
    '.fbcdn.net',
    '.fbsbx.com',
    '.cdninstagram.com',
    '.googleusercontent.com',
    '.r2.dev',
    '.cloudflarestorage.com',
];

/**
 * Validate magic bytes to prevent masqueraded executable uploads
 */
function isAllowedMediaType(header: Uint8Array): boolean {
    if (header.length < 4) return false;

    // JPEG: FF D8 FF
    if (header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF) return true;
    // PNG: 89 50 4E 47
    if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47) return true;
    // GIF: 47 49 46 38 (GIF8)
    if (header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x38) return true;
    // WEBP: 52 49 46 46 (RIFF)
    if (header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46) return true;
    // MP4: usually 00 00 00 xx 66 74 79 70 (ftyp)
    if (header.length >= 8 && header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70) return true;
    // WebM: 1A 45 DF A3
    if (header[0] === 0x1A && header[1] === 0x45 && header[2] === 0xDF && header[3] === 0xA3) return true;
    // MOV (QuickTime): xx xx xx xx 6d 6f 6f 76 (moov) or mdat or ftypqt
    if (header.length >= 8 && header[4] === 0x6D && header[5] === 0x6F && header[6] === 0x6F && header[7] === 0x76) return true;
    if (header.length >= 8 && header[4] === 0x6D && header[5] === 0x64 && header[6] === 0x61 && header[7] === 0x74) return true;
    
    return false;
}

/**
 * Check if a URL is an external CDN URL that should be persisted to R2.
 * Returns true for Facebook CDN URLs and other external image URLs.
 * Returns false for data: URLs (base64), R2 URLs (already persisted), and relative URLs.
 */
export function isExternalImageUrl(url: string): boolean {
    if (!url) return false;
    if (url.startsWith('data:')) return false;
    if (url.includes('r2.dev')) return false;
    if (url.includes('buenadoptante')) return false;
    if (url.startsWith('/')) return false;
    if (!url.startsWith('http://') && !url.startsWith('https://')) return false;

    try {
        const urlObj = new URL(url);
        if (urlObj.protocol !== 'https:') return false; // Strict HTTPS
        const hostname = urlObj.hostname.toLowerCase();
        return ALLOWED_DOMAINS.some(d => hostname.endsWith(d));
    } catch {
        return false;
    }
}

/**
 * Detect the file extension from a URL or content-type header.
 */
function getExtension(url: string, contentType?: string | null): string {
    if (contentType) {
        if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
        if (contentType.includes('png')) return 'png';
        if (contentType.includes('webp')) return 'webp';
        if (contentType.includes('gif')) return 'gif';
        if (contentType.includes('mp4')) return 'mp4';
        if (contentType.includes('webm')) return 'webm';
        if (contentType.includes('quicktime') || contentType.includes('mov')) return 'mov';
    }
    // Try extracting from URL path (before query string)
    const path = url.split('?')[0];
    const ext = path.split('.').pop()?.toLowerCase();
    if (ext && ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm', 'mov'].includes(ext)) {
        return ext === 'jpeg' ? 'jpg' : ext;
    }
    return 'jpg'; // Default assumption
}

/**
 * Upload an image to R2 from its binary data.
 * Returns the public R2 URL.
 */
export async function uploadToR2(
    key: string,
    data: ArrayBuffer | Uint8Array,
    contentType: string
): Promise<string> {
    const { env } = getRequestContext();
    const bucket = (env as unknown as Record<string, unknown>).IMAGES_BUCKET as R2Bucket | undefined;

    if (!bucket) {
        logger.warn('[R2] IMAGES_BUCKET binding not available, falling back to original URL');
        throw new Error('R2 bucket not configured');
    }

    // Retry with exponential backoff (2 retries: 500ms, 1s)
    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            await bucket.put(key, data, {
                httpMetadata: {
                    contentType,
                    cacheControl: 'public, max-age=31536000', // 1 year cache
                },
            });
            return `${R2_PUBLIC_URL}/${key}`;
        } catch (err) {
            if (attempt === MAX_RETRIES) throw err;
            const delay = 500 * Math.pow(2, attempt); // 500ms, 1000ms
            logger.warn(`[R2] Upload attempt ${attempt + 1} failed, retrying in ${delay}ms...`, { error: (err as Error).message });
            await new Promise(r => setTimeout(r, delay));
        }
    }
    // Unreachable, but satisfies TS
    throw new Error('R2 upload failed after retries');
}

/**
 * Download an external image and upload it to R2.
 * Returns the permanent R2 URL, or null if download fails.
 */
export async function persistImageToR2(
    externalUrl: string,
    adopterId: string,
    imageId?: string,
): Promise<string | null> {
    try {
        // Download the image
        const response = await fetch(externalUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Accept': 'image/*,video/*,*/*',
            },
            redirect: 'follow',
        });

        if (!response.ok) {
            logger.warn(`[R2] Failed to download image`, { status: response.status, externalUrl: externalUrl.substring(0, 80) });
            return null;
        }

        const contentType = response.headers.get('content-type') || 'image/jpeg';
        const isVideo = contentType.startsWith('video/');
        const ext = getExtension(externalUrl, contentType);
        const id = imageId || crypto.randomUUID();
        const key = `adopters/${adopterId}/${id}.${ext}`;

        const arrayBuffer = await response.arrayBuffer();

        // Magic Bytes Validation 
        const header = new Uint8Array(arrayBuffer.slice(0, 12));
        if (!isAllowedMediaType(header)) {
            logger.error('[R2] Invalid media type magic bytes', { externalUrl });
            return null;
        }

        // Skip if too small (likely a 1x1 pixel or error response) — but not for videos
        if (!isVideo && arrayBuffer.byteLength < 1000) {
            logger.warn(`[R2] Image too small, skipping`, { bytes: arrayBuffer.byteLength, externalUrl: externalUrl.substring(0, 80) });
            return null;
        }

        const r2Url = await uploadToR2(key, arrayBuffer, contentType);
        return r2Url;
    } catch (error) {
        logger.error(`[R2] Error persisting image`, { error: error instanceof Error ? error.message : String(error) });
        return null;
    }
}

/**
 * Process a media URL for storage:
 * - External URLs (Facebook CDN etc.) → download and upload to R2
 * - Video data URLs → decode and upload to R2 (too large for D1)
 * - Image data URLs → return as-is (stored in D1, small after compression)
 * - R2 URLs → return as-is (already persisted)
 */
export async function processImageForStorage(
    url: string,
    adopterId: string,
    imageId?: string,
): Promise<string> {
    // External URLs: download and persist to R2
    if (isExternalImageUrl(url)) {
        const r2Url = await persistImageToR2(url, adopterId, imageId);
        return r2Url || url;
    }

    // Video data URLs: decode and upload to R2 (too large for D1 column)
    if (url.startsWith('data:video/')) {
        try {
            const r2Url = await uploadDataUrlToR2(url, adopterId, imageId);
            if (r2Url) return r2Url;
        } catch (e) {
            logger.error('[R2] Failed to upload video data URL to R2', { error: (e as Error).message });
        }
    }

    return url; // Images as data URLs, or already R2 URLs
}

/**
 * Decode a base64 data URL and upload it to R2.
 * Used for video uploads that are too large for D1.
 */
async function uploadDataUrlToR2(
    dataUrl: string,
    adopterId: string,
    imageId?: string,
): Promise<string | null> {
    // Parse data URL: data:video/mp4;base64,AAAA...
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;

    const contentType = match[1];
    const base64Data = match[2];
    const ext = getExtension('', contentType);
    const id = imageId || crypto.randomUUID();
    const key = `adopters/${adopterId}/${id}.${ext}`;

    // Decode base64 to binary (Edge-compatible)
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }

    const r2Url = await uploadToR2(key, bytes, contentType);
    return r2Url;
}
