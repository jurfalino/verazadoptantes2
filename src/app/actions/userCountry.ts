'use server';

import { logger } from '@/lib/logger';

/**
 * The viewer's profile country (`user_profiles.country`), or null. Lifted from
 * runDiscoveryMode so the search box's lazy weak tier can apply the same
 * geo re-check without importing the whole engine. Best-effort: any failure
 * (unauth, no request context, DB hiccup) returns null → no geo filtering,
 * which fails open (shows more, never hides). Raw D1 query because the auth
 * tables aren't in the Drizzle schema.
 */
export async function getUserCountry(user: string | null | undefined): Promise<string | null> {
    if (!user || user === 'unknown') return null;
    try {
        const { env } = (await import('@cloudflare/next-on-pages')).getRequestContext();
        if (!env?.DB) return null;
        const row = await env.DB.prepare(
            `SELECT up.country FROM user_profiles up JOIN user u ON u.id = up.user_id WHERE u.email = ? LIMIT 1`
        ).bind(user).first<{ country: string | null }>();
        return row?.country || null;
    } catch (e) {
        logger.warn('getUserCountry: lookup failed (fail-open)', {
            error: e instanceof Error ? e.message : String(e),
        });
        return null;
    }
}
