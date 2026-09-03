/**
 * PostHog reverse-proxy URL mapping.
 *
 * All PostHog traffic is proxied same-origin through `/ingest/*` (see
 * `src/app/ingest/[...path]/route.ts`). Same-origin is load-bearing twice
 * over: the CSP in `next.config.ts` allowlists `connect-src` per host, and
 * `'self'` covers a path but would not cover a `ph.` subdomain; and
 * adblockers that would drop a request to `us.i.posthog.com` cannot
 * distinguish `/ingest` from the app's own API.
 *
 * This module is pure so the routing can be unit-tested — CI cannot exercise
 * the real proxy without reaching PostHog over the network.
 *
 * Region is US and is a one-way door: PostHog cannot migrate a project
 * between regions.
 */

export const POSTHOG_API_HOST = 'https://us.i.posthog.com';
export const POSTHOG_ASSET_HOST = 'https://us-assets.i.posthog.com';

/** Path prefixes PostHog serves from its static-asset host rather than the API host. */
const ASSET_PREFIXES = ['static', 'array'];

/**
 * Map a proxied `/ingest/*` request to its absolute PostHog URL.
 *
 * @param pathSegments - the `[...path]` catch-all segments, without `/ingest`
 * @param search - the original query string, including the leading `?` (or empty)
 */
export function resolvePostHogTarget(pathSegments: string[], search: string): string {
    const host = ASSET_PREFIXES.includes(pathSegments[0]) ? POSTHOG_ASSET_HOST : POSTHOG_API_HOST;
    return `${host}/${pathSegments.join('/')}${search}`;
}
