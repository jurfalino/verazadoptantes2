export const runtime = 'edge';

import { getRequestContext } from '@cloudflare/next-on-pages';
import * as schema from '@/db/schema';

export async function GET(request: Request) {
    const url = new URL(request.url);
    const query = url.searchParams.get('q') || 'jon';

    const debug: Record<string, unknown> = {
        timestamp: new Date().toISOString(),
        query,
    };

    try {
        const { env } = getRequestContext();
        debug.hasDB = !!env?.DB;

        if (env?.DB) {
            const { drizzle } = await import("drizzle-orm/d1");
            const db = drizzle(env.DB, { schema });

            // Get ALL adopters first
            const allAdopters = await db.select({
                id: schema.adopters.id,
                name: schema.adopters.name,
                contactInfo: schema.adopters.contactInfo,
            }).from(schema.adopters);
            debug.allAdopters = allAdopters;

            // Try raw SQL LIKE
            const rawResult = await env.DB.prepare(
                `SELECT id, name, contact_info FROM adopters WHERE name LIKE ?`
            ).bind(`%${query}%`).all();
            debug.rawSqlResult = rawResult.results;

            // Try drizzle LIKE
            const { like } = await import("drizzle-orm");
            const drizzleResult = await db.select({
                id: schema.adopters.id,
                name: schema.adopters.name,
            }).from(schema.adopters).where(
                like(schema.adopters.name, `%${query}%`)
            );
            debug.drizzleResult = drizzleResult;

            // Try exact match
            const { eq } = await import("drizzle-orm");
            const exactResult = await db.select({
                id: schema.adopters.id,
                name: schema.adopters.name,
            }).from(schema.adopters).where(
                eq(schema.adopters.name, query)
            );
            debug.exactMatchResult = exactResult;
        }
    } catch (e) {
        debug.error = e instanceof Error ? e.message : String(e);
        debug.stack = e instanceof Error ? e.stack : undefined;
    }

    return Response.json(debug, {
        headers: { 'Content-Type': 'application/json' }
    });
}
