/**
 * R2 Media Storage Helper
 * 
 * Downloads external images and videos and uploads them to Cloudflare R2 for permanent storage.
 * This solves the problem of social media CDN URLs expiring after a few days/weeks.
 */

import { getRequestContext } from '@cloudflare/next-on-pages';

const R2_PUBLIC_URL = 'https://pub-bb28dd8b1e674fc189252b0000a7b573.r2.dev';

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
    return url.startsWith('http://') || url.startsWith('https://');
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
        console.warn('[R2] IMAGES_BUCKET binding not available, falling back to original URL');
        throw new Error('R2 bucket not configured');
    }

    await bucket.put(key, data, {
        httpMetadata: {
            contentType,
            cacheControl: 'public, max-age=31536000', // 1 year cache
        },
    });

    return `${R2_PUBLIC_URL}/${key}`;
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
            console.warn(`[R2] Failed to download image: ${response.status} for ${externalUrl.substring(0, 80)}`);
            return null;
        }

        const contentType = response.headers.get('content-type') || 'image/jpeg';
        const isVideo = contentType.startsWith('video/');
        const ext = getExtension(externalUrl, contentType);
        const id = imageId || crypto.randomUUID();
        const key = `adopters/${adopterId}/${id}.${ext}`;

        const arrayBuffer = await response.arrayBuffer();

        // Skip if too small (likely a 1x1 pixel or error response) — but not for videos
        if (!isVideo && arrayBuffer.byteLength < 1000) {
            console.warn(`[R2] Image too small (${arrayBuffer.byteLength} bytes), skipping: ${externalUrl.substring(0, 80)}`);
            return null;
        }

        const r2Url = await uploadToR2(key, arrayBuffer, contentType);
        console.log(`[R2] Persisted media: ${externalUrl.substring(0, 60)} → ${key} (${Math.round(arrayBuffer.byteLength / 1024)}KB)`);
        return r2Url;
    } catch (error) {
        console.error(`[R2] Error persisting image:`, error);
        return null;
    }
}

/**
 * Process an image URL for storage:
 * - External URLs (Facebook CDN etc.) → download and upload to R2
 * - Data URLs (base64/manual uploads) → return as-is (stored in D1)
 * - R2 URLs → return as-is (already persisted)
 */
export async function processImageForStorage(
    url: string,
    adopterId: string,
    imageId?: string,
): Promise<string> {
    if (!isExternalImageUrl(url)) {
        return url; // Already safe (base64 or R2 URL)
    }

    const r2Url = await persistImageToR2(url, adopterId, imageId);
    return r2Url || url; // Fall back to original URL if R2 upload fails
}
