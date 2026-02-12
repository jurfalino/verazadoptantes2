export const runtime = 'edge';

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
    // Auth check — signed-in users OR legitimate anonymous users
    const session = await auth();
    const isAnon = request.cookies.get('anon_user')?.value === 'true';

    if (!session?.user && !isAnon) {
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

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            }
        });

        if (!response.ok) {
            return new NextResponse('Failed to fetch image', { status: response.status });
        }

        const headers = new Headers(response.headers);
        headers.set('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour

        return new NextResponse(response.body, {
            status: 200,
            headers,
        });
    } catch (error) {
        logger.error('Proxy image fetch failed', error);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
}
