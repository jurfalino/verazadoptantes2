export const runtime = 'edge';

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';

const QR_API = 'https://api.qrserver.com/v1/create-qr-code/';

/**
 * Proxy QR code image from api.qrserver.com so the img src is same-origin
 * and allowed by CSP (img-src 'self').
 * GET /api/qr?data=<url-encoded-text>
 */
export async function GET(request: NextRequest) {
    const session = await auth();
    if (!session?.user) {
        return new NextResponse('Unauthorized', { status: 401 });
    }

    const data = request.nextUrl.searchParams.get('data');
    if (!data?.trim()) {
        return new NextResponse('Missing data', { status: 400 });
    }

    try {
        const qrUrl = `${QR_API}?size=220x220&margin=8&data=${encodeURIComponent(data)}`;
        // Pass `cf.cacheTtl` instead of the standard `cache` hint — Workers
        // ignores the latter. 24h TTL matches the upstream image stability.
        const res = await fetch(qrUrl, {
            cf: { cacheTtl: 86400, cacheEverything: true },
        } as RequestInit);
        if (!res.ok || !res.body) {
            return new NextResponse('QR service error', { status: 502 });
        }
        // Stream the body straight through. Awaiting `.blob()` and re-wrapping
        // in a Response has been observed to silently drop binary data on the
        // edge runtime; passing the ReadableStream is the canonical pattern.
        const contentType = res.headers.get('content-type') || 'image/png';
        return new NextResponse(res.body, {
            headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=86400',
            },
        });
    } catch (e) {
        return new NextResponse('QR fetch failed', { status: 502 });
    }
}
