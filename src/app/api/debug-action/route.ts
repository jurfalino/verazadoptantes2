export const runtime = 'edge';

import { searchAdopter, getDb } from '@/app/actions';
import { getRequestContext } from '@cloudflare/next-on-pages';

export async function GET(request: Request) {
    const url = new URL(request.url);
    const query = url.searchParams.get('q') || 'jon';

    const debug: Record<string, unknown> = {
        timestamp: new Date().toISOString(),
        query,
    };

    // First test getDb directly
    try {
        const db = await getDb();
        debug.getDbResult = db ? "returned db instance" : "returned undefined";
        debug.dbType = db ? typeof db : "undefined";
    } catch (e) {
        debug.getDbError = e instanceof Error ? e.message : String(e);
    }

    // Test getRequestContext directly
    try {
        const { env } = getRequestContext();
        debug.directEnvCheck = {
            hasEnv: !!env,
            hasDB: !!env?.DB,
        };
    } catch (e) {
        debug.directEnvError = e instanceof Error ? e.message : String(e);
    }

    // Now test searchAdopter
    try {
        const response = await searchAdopter(query);
        const results = response.results;
        debug.searchSuccess = true;
        debug.resultCount = results?.length ?? 0;
        debug.firstResult = results?.[0] ? {
            id: results[0].adopter.id,
            name: results[0].adopter.name,
        } : null;
        debug.truncated = response.truncated;
        debug.validationError = response.validationError;
    } catch (e) {
        debug.searchSuccess = false;
        debug.searchError = e instanceof Error ? e.message : String(e);
        debug.searchStack = e instanceof Error ? e.stack?.split('\n').slice(0, 5) : undefined;
    }

    return Response.json(debug, {
        headers: { 'Content-Type': 'application/json' }
    });
}
