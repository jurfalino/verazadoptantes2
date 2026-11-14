/**
 * Client-side: fetch a social post's text and images for an import — the same
 * two endpoints the person import (ImportWizard.handleFetchUrl) calls: Facebook
 * links go to the Playwright scraper route, everything else to fetch-content.
 * Used by «Cargar un animal desde un post» (Jon 2026-11-14).
 */
import { dedupeImages } from '@/domain/facebookExtraction';

/** Same cap as the person import's review grid (ImportWizard MAX_FETCHED_IMAGES). */
export const MAX_POST_IMAGES = 12;

export type FetchedPost =
    | { ok: true; text: string; images: string[]; resolvedUrl: string; missingText: boolean }
    /** `unreadable`: private, deleted or a wall — the link is still worth keeping. `error`: anything else. */
    | { ok: false; kind: 'unreadable' | 'error'; resolvedUrl: string; message?: string };

const FB = /^https?:\/\/(www\.|m\.|web\.)?(facebook\.com|fb\.com)\//i;

export async function fetchPostForImport(url: string): Promise<FetchedPost> {
    const target = url.trim();
    if (FB.test(target)) {
        const res = await fetch('/api/facebook/fetch-post', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: target }),
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const body: any = await res.json().catch(() => ({}));
        const resolvedUrl: string = body?.resolvedUrl || target;
        if (!res.ok) return { ok: false, kind: body?.requiresManualInput ? 'unreadable' : 'error', resolvedUrl, message: body?.error };
        if (body?.success && body.data) {
            let images = dedupeImages(body.data.images || []).slice(0, MAX_POST_IMAGES);
            // A video post's poster comes back as base64: it IS images[0] (see ImportWizard).
            if ((body.isVideo || body.data.isVideo) && body.data.videoThumbnailBase64) {
                images = images.length > 0 ? [body.data.videoThumbnailBase64, ...images.slice(1)] : [body.data.videoThumbnailBase64];
            }
            return { ok: true, text: body.data.text || '', images, resolvedUrl, missingText: !!body.missingPostText };
        }
        if (body?.extractionFailed) return { ok: false, kind: body.requiresManualInput ? 'unreadable' : 'error', resolvedUrl, message: body.error };
        return { ok: false, kind: 'error', resolvedUrl, message: body?.error };
    }
    const res = await fetch('/api/import/fetch-content', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: target }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, kind: body?.requiresManualInput ? 'unreadable' : 'error', resolvedUrl: target, message: body?.error };
    if (body?.success && body.data) {
        return {
            ok: true,
            text: body.data.text || '',
            images: dedupeImages(body.data.images || []).slice(0, MAX_POST_IMAGES),
            resolvedUrl: target,
            missingText: !(body.data.text || '').trim(),
        };
    }
    return { ok: false, kind: 'error', resolvedUrl: target, message: body?.error };
}
