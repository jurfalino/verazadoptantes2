/**
 * Canonical database accessor — single source of truth for getting a Drizzle DB instance.
 *
 * Use this from API routes, config modules, and anywhere that needs Drizzle
 * without pulling in the full server actions barrel.
 *
 * Server actions re-export this via `actions/_db.ts` for convenience.
 *
 * The D1 binding comes through src/lib/requestContext.ts, so writes fail while
 * an admin is viewing the app as another user (src/lib/readOnlyGuard.ts).
 */

import { getRequestContext } from '@/lib/requestContext';
import { createDb } from '@/db';
import { logger } from '@/lib/logger';

export async function getDb() {
    try {
        const { env } = getRequestContext();
        if (env && env.DB) {
            return await createDb(env.DB);
        }
    } catch {
        // Not in Cloudflare context — fall through to local dev
    }

    // Fallback for local development. There is no Cloudflare context to guard
    // here, so a read-only request ("view as") gets the file opened read-only.
    if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
        try {
            const { createLocalDb } = await import('@/db/local');
            const { isRequestReadOnly } = await import('@/lib/readOnlyGuard');
            return await createLocalDb('local.db', { readOnly: isRequestReadOnly() });
        } catch (e) {
            logger.error("[getDb] Local DB Init Error", { error: e instanceof Error ? e.message : String(e) });
        }
    }
    return undefined;
}
