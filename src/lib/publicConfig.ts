/**
 * Public feature-flag read — shared by /api/config (REST consumers) and the
 * homepage SSR (server-component config fetch). Was inlined in
 * /api/config/route.ts until v2.14.9-13 moved the homepage's flag fetch from
 * a client-side useEffect to a server-component prop, which needed the same
 * logic available to a non-API caller.
 *
 * The 30-second in-memory cache is keyed only by "called or not" (singleton),
 * since the DB rows in `app_config` change rarely (admin flips a flag in
 * /admin/config). On a flag flip, all workers within ~30s will still serve
 * the stale value — that's a deliberate tradeoff for homepage LCP. If we ever
 * need instant flag propagation, the admin/config save path can clear the
 * cache via a /api/admin/cache-bust endpoint (not in scope here).
 */

import { getDb } from '@/lib/db';
import { appConfig } from '@/db/schema';
import { inArray } from 'drizzle-orm';
import { logger } from '@/lib/logger';

export const PUBLIC_FLAG_KEYS = [
    'ENABLE_CONTENT_IMPORT',
    'ENABLE_ANIMALS_FOR_ADOPTION',
    'ENABLE_SEARCH_CARD_METADATA',
    'ENABLE_MILESTONE_BADGE',
    'ENABLE_QUICK_ACCESS_STRIP',
    'ENABLE_CONTACT_PASTE',
    'SOCIAL_PROOF_ENABLED',
    'SOCIAL_PROOF_MESSAGES',
    // v2.14.10-1: showcase URL-chip visibility + Instagram CTA target.
    // /my-animals reads these client-side to render the copy chips.
    // The Vite-app showcase pages also read INSTAGRAM_URL for the empty
    // state. All three SHOWCASE_*_VISIBLE default to false.
    'SHOWCASE_GLOBAL_VISIBLE',
    'SHOWCASE_ORG_VISIBLE',
    'SHOWCASE_USER_VISIBLE',
    'INSTAGRAM_URL',
] as const;

export const PUBLIC_FLAG_DEFAULTS: Record<string, string> = {
    ENABLE_CONTENT_IMPORT: 'false',
    ENABLE_ANIMALS_FOR_ADOPTION: 'false',
    ENABLE_SEARCH_CARD_METADATA: 'true',
    ENABLE_MILESTONE_BADGE: 'true',
    ENABLE_QUICK_ACCESS_STRIP: 'true',
    ENABLE_CONTACT_PASTE: 'true',
    SOCIAL_PROOF_ENABLED: 'false',
    SOCIAL_PROOF_MESSAGES: '[]',
    SHOWCASE_GLOBAL_VISIBLE: 'false',
    SHOWCASE_ORG_VISIBLE: 'false',
    SHOWCASE_USER_VISIBLE: 'false',
    INSTAGRAM_URL: '',
};

const CACHE_TTL_MS = 30 * 1000;
let _cache: { value: Record<string, string>; expiresAt: number } | null = null;

/**
 * Reads the whitelisted public flags from the `app_config` D1 table and
 * returns them merged with the defaults. Cached 30s per worker; resets on
 * cold start. Never throws — returns defaults on DB failure (logged at warn).
 */
export async function getPublicConfig(): Promise<Record<string, string>> {
    if (_cache && _cache.expiresAt > Date.now()) {
        return _cache.value;
    }

    let value: Record<string, string> = { ...PUBLIC_FLAG_DEFAULTS };
    try {
        const db = await getDb();
        if (db) {
            const rows = await db.select().from(appConfig)
                .where(inArray(appConfig.key, [...PUBLIC_FLAG_KEYS]));
            for (const row of rows) {
                value[row.key] = row.value;
            }
        }
    } catch (e) {
        // Same warn pattern as /api/config previously: don't kill the caller
        // on a transient D1 hiccup. Defaults are safe (all flags off / safe).
        logger.warn('getPublicConfig: D1 read failed, serving defaults', {
            error: e instanceof Error ? e.message : String(e),
        });
        value = { ...PUBLIC_FLAG_DEFAULTS };
    }

    _cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
}
