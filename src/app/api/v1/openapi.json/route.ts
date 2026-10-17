// OpenAPI 3.1 spec of the third-party API, generated from src/lib/api/schemas.ts.
import { NextResponse } from 'next/server';
import { getFeatureFlag } from '@/config/features';
import { buildOpenApi } from '@/lib/api/openapi';
import { getAdoptionConfig } from '@/app/actions/config';

export const runtime = 'edge';

export async function GET(request: Request) {
    if (!(await getFeatureFlag('ENABLE_PUBLIC_API'))) return NextResponse.json({ error: 'not found' }, { status: 404 });
    // This environment's alert thresholds: the documented answers are the ones it gives.
    return NextResponse.json(buildOpenApi(new URL(request.url).origin, await getAdoptionConfig()), {
        headers: { 'cache-control': 'public, max-age=300' },
    });
}
