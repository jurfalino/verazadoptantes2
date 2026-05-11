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
                'Cache-Control': 'public, max-age=60, stale-while-revalidate=600',
            },
        }
    );
}
