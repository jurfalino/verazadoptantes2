export const runtime = 'edge';

import { NextRequest, NextResponse } from 'next/server';

/**
 * POST handler for Web Share Target API — fallback route.
 *
 * In production, the Service Worker intercepts the POST first and handles
 * image caching + redirect. This route exists as a fallback in case
 * the SW is not yet active (first install, update pending, etc.).
 *
 * It handles text/URL data but cannot forward shared images
 * (binary data can't be passed via URL redirect).
 */
export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();

        let sharedUrl = formData.get('url') as string || '';
        let sharedText = formData.get('text') as string || '';
        const sharedTitle = formData.get('title') as string || '';

        // Many Android apps put URLs in the text field
        if (!sharedUrl && sharedText) {
            const urlMatch = sharedText.match(/https?:\/\/[^\s]+/i);
            if (urlMatch) {
                sharedUrl = urlMatch[0];
                sharedText = sharedText.replace(urlMatch[0], '').trim();
            }
        }

        // Build redirect URL with shared content as query params
        const params = new URLSearchParams();
        params.set('shared', 'true');

        if (sharedUrl) params.set('shared_url', sharedUrl);
        if (sharedText) params.set('shared_text', sharedText);
        if (sharedTitle) params.set('shared_title', sharedTitle);

        // Check if files were included (SW didn't intercept)
        const imageFiles = formData.getAll('images');
        if (imageFiles && imageFiles.length > 0 && imageFiles[0] instanceof File && (imageFiles[0] as File).size > 0) {
            // Flag that images were shared but couldn't be cached (SW not active)
            params.set('shared_images_lost', 'true');
        }

        // Check for shared vCard (v2.16.0-33). The SW caches the file and the
        // wizard reads it from there; if we're here, the SW is inactive and
        // the file body can't survive a 303 redirect — flag it as lost so the
        // wizard renders a soft hint instead of silently staying on Step 1.
        const vcardFiles = formData.getAll('vcard');
        if (vcardFiles && vcardFiles.length > 0 && vcardFiles[0] instanceof File && (vcardFiles[0] as File).size > 0) {
            params.set('shared_vcard_lost', 'true');
        }

        return NextResponse.redirect(
            new URL(`/import?${params.toString()}`, request.url),
            303
        );
    } catch {
        return NextResponse.redirect(new URL('/import?shared=true', request.url), 303);
    }
}
