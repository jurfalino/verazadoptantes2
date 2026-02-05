export const runtime = 'edge';

import { searchAdopter } from '@/app/actions';

export async function GET(request: Request) {
    const url = new URL(request.url);
    const query = url.searchParams.get('q') || 'test';

    const debug: Record<string, unknown> = {
        timestamp: new Date().toISOString(),
        query,
    };

    try {
        console.log("[debug-action] Calling searchAdopter with:", query);
        const results = await searchAdopter(query);
        console.log("[debug-action] Got results:", results?.length);
        debug.success = true;
        debug.resultCount = results?.length ?? 0;
        debug.firstResult = results?.[0] ? {
            id: results[0].adopter.id,
            name: results[0].adopter.name,
        } : null;
    } catch (e) {
        debug.success = false;
        debug.error = e instanceof Error ? e.message : String(e);
        debug.stack = e instanceof Error ? e.stack?.split('\n').slice(0, 5) : undefined;
    }

    return Response.json(debug, {
        headers: { 'Content-Type': 'application/json' }
    });
}
