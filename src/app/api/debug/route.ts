export const runtime = 'edge';

import { getRequestContext } from '@cloudflare/next-on-pages';

export async function GET() {
    const debug: Record<string, unknown> = {
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV,
    };

    try {
        const { env } = getRequestContext();
        debug.hasEnv = !!env;
        debug.hasDB = !!env?.DB;
        debug.envKeys = env ? Object.keys(env) : [];

        if (env?.DB) {
            // Try a simple query
            try {
                const result = await env.DB.prepare('SELECT 1 as test').first();
                debug.dbConnection = 'success';
                debug.dbResult = result;
            } catch (dbError) {
                debug.dbConnection = 'failed';
                debug.dbError = dbError instanceof Error ? dbError.message : String(dbError);
            }
        }
    } catch (e) {
        debug.contextError = e instanceof Error ? e.message : String(e);
    }

    return Response.json(debug, {
        headers: { 'Content-Type': 'application/json' }
    });
}
