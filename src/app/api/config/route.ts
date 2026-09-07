export const runtime = 'edge';
import { NextResponse } from "next/server";
import { getPublicConfig, PUBLIC_FLAG_DEFAULTS } from "@/lib/publicConfig";

/**
 * Public endpoint: returns the whitelisted UI feature flags.
 * No authentication required — these flags control client-side UI visibility
 * for ALL users (not just admins). Sensitive admin config stays in /api/admin/config.
 *
 * As of v2.14.9-13, the homepage fetches the same data server-side via
 * `getPublicConfig()` (avoiding the LCP-critical client-side fetch), so this
 * route mostly serves any other consumers and the rare cache miss. We still
 * keep it: external integrations, contract-app, and dev tooling rely on it.
 *
 * Response is browser-cacheable for 60s with stale-while-revalidate so the
 * remaining consumers don't hit D1 on every page load.
 */
export async function GET() {
    const config = await getPublicConfig().catch(() => ({ ...PUBLIC_FLAG_DEFAULTS }));
    return NextResponse.json(
        { config },
        {
            headers: {
                // Control-plane endpoint: an admin flipping a flag in /admin
                // expects it to take effect, not in ten minutes. The previous
                // `max-age=60, stale-while-revalidate=600` meant the browser
                // could answer for 60s as fresh and 600s as stale WITHOUT a
                // network request — and because the service worker's
                // networkFirst uses fetch(), its "network" attempt was served
                // from that same HTTP cache, so the SW gave no protection
                // either. That is why ENABLE_EMAIL_OTP stayed invisible in prod
                // after being switched on (2026-09-07).
                //
                // must-revalidate keeps the response cacheable but forces a
                // conditional request every time; a 304 on this small JSON is
                // cheap, and the homepage reads the flags server-side via
                // getPublicConfig() so this is not on the LCP path.
                'Cache-Control': 'public, max-age=0, must-revalidate',
            },
        }
    );
}
