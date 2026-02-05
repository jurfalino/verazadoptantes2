export const runtime = 'edge';

import { getRequestContext } from '@cloudflare/next-on-pages';
import * as schema from '@/db/schema';

export async function GET(request: Request) {
    const url = new URL(request.url);
    const query = url.searchParams.get('q') || 'test';

    const debug: Record<string, unknown> = {
        timestamp: new Date().toISOString(),
        query,
    };

    try {
        const { env } = getRequestContext();
        debug.hasDB = !!env?.DB;

        if (env?.DB) {
            // Import drizzle dynamically
            const { drizzle } = await import("drizzle-orm/d1");
            const db = drizzle(env.DB, { schema });
            debug.drizzleLoaded = true;

            // Try to count adopters
            try {
                const { sql } = await import("drizzle-orm");
                const countResult = await db.select({ count: sql`count(*)` }).from(schema.adopters);
                debug.adopterCount = countResult[0]?.count;
            } catch (countErr) {
                debug.countError = countErr instanceof Error ? countErr.message : String(countErr);
            }

            // Try search
            try {
                const { like, or } = await import("drizzle-orm");
                const results = await db.select().from(schema.adopters).where(
                    or(
                        like(schema.adopters.name, `%${query}%`),
                        like(schema.adopters.contactInfo, `%${query}%`)
                    )
                ).limit(5);
                debug.searchResults = results.length;
                debug.firstResult = results[0] ? { id: results[0].id, name: results[0].name } : null;
            } catch (searchErr) {
                debug.searchError = searchErr instanceof Error ? searchErr.message : String(searchErr);
            }
        }
    } catch (e) {
        debug.error = e instanceof Error ? e.message : String(e);
        debug.stack = e instanceof Error ? e.stack : undefined;
    }

    return Response.json(debug, {
        headers: { 'Content-Type': 'application/json' }
    });
}
