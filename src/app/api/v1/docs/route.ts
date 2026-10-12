// Interactive API explorer (Scalar) over /api/v1/openapi.json. Partners try
// calls here with a ba_test_ key on staging. Locked down: see src/lib/api/docsPage.ts.
import { NextResponse } from 'next/server';
import { getFeatureFlag } from '@/config/features';
import { CSP, PAGE } from '@/lib/api/docsPage';

export const runtime = 'edge';

export async function GET() {
    if (!(await getFeatureFlag('ENABLE_PUBLIC_API'))) return new NextResponse('Not found', { status: 404 });
    return new NextResponse(PAGE, {
        headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'public, max-age=300',
            'content-security-policy': CSP,
            'referrer-policy': 'no-referrer',
            'x-content-type-options': 'nosniff',
        },
    });
}
