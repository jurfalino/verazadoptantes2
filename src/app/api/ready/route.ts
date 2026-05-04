export const runtime = 'edge';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { appConfig } from '@/db/schema';

/**
 * Strict readiness probe: returns 200 ONLY when the D1 binding can actually
 * answer a query. Used by Playwright's webServer.url to wait out the boot race
 * between miniflare and the Next.js dev server. Production cold starts can
 * hit it too if needed.
 *
 * Unlike /api/config (which falls back to defaults on DB failure) and /api/health
 * (which probes external services with their own timeouts), this endpoint only
 * cares about one thing: is the local D1 binding alive?
 */
export async function GET() {
    try {
        const db = await getDb();
        if (!db) {
            return NextResponse.json(
                { ready: false, reason: 'no-db-binding' },
                { status: 503, headers: { 'Cache-Control': 'no-store' } },
            );
        }
        // Cheapest possible query that exercises the binding end-to-end.
        await db.select().from(appConfig).limit(1);
        return NextResponse.json(
            { ready: true },
            { status: 200, headers: { 'Cache-Control': 'no-store' } },
        );
    } catch (e) {
        return NextResponse.json(
            { ready: false, reason: e instanceof Error ? e.message : 'unknown' },
            { status: 503, headers: { 'Cache-Control': 'no-store' } },
        );
    }
}
