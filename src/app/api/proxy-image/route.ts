export const runtime = 'edge';

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
    // Auth check — signed-in users only
    const session = await auth();

    if (!session?.user) {
        return new NextResponse('Unauthorized', { status: 401 });
    }

    const url = request.nextUrl.searchParams.get('url');

    if (!url) {
        return new NextResponse('URL is required', { status: 400 });
    }

    try {
        // Basic SSRF protection: block private/internal IPs
        const urlObj = new URL(url);
        const hostname = urlObj.hostname.toLowerCase();
        const blockedPatterns = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '10.', '192.168.', '172.16.', '169.254.'];
        if (blockedPatterns.some(p => hostname.startsWith(p) || hostname === p)) {
            return new NextResponse('URL not allowed', { status: 403 });
        }

        // Build upstream request headers — forward Range for video streaming
        const upstreamHeaders: Record<string, string> = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        };
        const rangeHeader = request.headers.get('Range');
        if (rangeHeader) {
            upstreamHeaders['Range'] = rangeHeader;
        }

        const response = await fetch(url, { headers: upstreamHeaders });

        if (!response.ok && response.status !== 206) {
            return new NextResponse('Failed to fetch media', { status: response.status });
        }

        // Build response headers — pass through content headers for proper media streaming
        const headers = new Headers();
        headers.set('Cache-Control', 'public, max-age=3600');

        // Forward essential content headers for media playback
        const contentType = response.headers.get('Content-Type');
        if (contentType) headers.set('Content-Type', contentType);

        const contentLength = response.headers.get('Content-Length');
        if (contentLength) headers.set('Content-Length', contentLength);

        const contentRange = response.headers.get('Content-Range');
        if (contentRange) headers.set('Content-Range', contentRange);

        // Always signal that we accept Range requests
        headers.set('Accept-Ranges', 'bytes');

        return new NextResponse(response.body, {
            status: response.status, // 200 for full content, 206 for partial
            headers,
        });
    } catch (error) {
        logger.error('Proxy media fetch failed', error);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
}
