export const runtime = 'edge';

import { NextRequest, NextResponse } from 'next/server';

/**
 * POST handler for Web Share Target API
 * 
 * When another app shares content to BuenAdoptante via the Android share sheet,
 * the browser sends a POST request here with the shared data (url, text, files).
 * We extract the data and redirect to /import with query params so the
 * ImportWizard can pre-fill the content.
 */
export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();

        let sharedUrl = formData.get('url') as string || '';
        let sharedText = formData.get('text') as string || '';
        const sharedTitle = formData.get('title') as string || '';

        // Many Android apps (Instagram, WhatsApp, etc.) put URLs in the text
        // field instead of the url field. Detect and extract URLs from text.
        if (!sharedUrl && sharedText) {
            const urlMatch = sharedText.match(/https?:\/\/[^\s]+/i);
            if (urlMatch) {
                sharedUrl = urlMatch[0];
                // Remove the URL from text, keep any surrounding context
                sharedText = sharedText.replace(urlMatch[0], '').trim();
            }
        }

        // Build redirect URL with shared content as query params
        const params = new URLSearchParams();
        params.set('shared', 'true');

        if (sharedUrl) {
            params.set('shared_url', sharedUrl);
        }
        if (sharedText) {
            params.set('shared_text', sharedText);
        }
        if (sharedTitle) {
            params.set('shared_title', sharedTitle);
        }

        // Redirect to import page with shared content
        return NextResponse.redirect(
            new URL(`/import?${params.toString()}`, request.url),
            303 // Use 303 See Other for POST-to-GET redirect
        );
    } catch (error) {
        // If parsing fails, redirect to import page without params
        return NextResponse.redirect(new URL('/import', request.url), 303);
    }
}
