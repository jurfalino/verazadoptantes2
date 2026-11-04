// OpenAPI 3.1 spec of the third-party API, generated from src/lib/api/schemas.ts.
import { NextResponse } from 'next/server';
import { getFeatureFlag } from '@/config/features';
import { buildOpenApi } from '@/lib/api/openapi';
import { getAdoptionConfig } from '@/app/actions/config';
import { apiPreflight, withCors } from '@/lib/api/cors';

export const runtime = 'edge';

// Browser tools (Hoppscotch's "import from URL") read the spec too; staging only, see cors.ts.
export const OPTIONS = apiPreflight;

export async function GET(request: Request) {
    if (!(await getFeatureFlag('ENABLE_PUBLIC_API'))) return withCors(NextResponse.json({ error: 'not found' }, { status: 404 }), request);
    // This environment's alert thresholds: the documented answers are the ones it gives.
    return withCors(NextResponse.json(buildOpenApi(new URL(request.url).origin, await getAdoptionConfig()), {
        headers: { 'cache-control': 'public, max-age=300' },
    }), request);
}
