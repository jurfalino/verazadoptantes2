/**
 * Canonical database accessor — single source of truth for getting a Drizzle DB instance.
 *
 * Use this from API routes, config modules, and anywhere that needs Drizzle
 * without pulling in the full server actions barrel.
 *
 * Server actions re-export this via `actions/_db.ts` for convenience.
 */

import { getRequestContext } from '@cloudflare/next-on-pages';
import { createDb } from '@/db';

export async function getDb() {
    try {
        const { env } = getRequestContext();
        if (env && env.DB) {
            return await createDb(env.DB);
        }
    } catch {
        // Not in Cloudflare context — fall through to local dev
    }

    // Fallback for local development
    if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
        try {
            const { createLocalDb } = await import('@/db/local');
            return await createLocalDb('local.db');
        } catch (e) {
            console.error("[getDb] Local DB Init Error:", e);
        }
    }
    return undefined;
}
