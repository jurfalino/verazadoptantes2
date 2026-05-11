export const runtime = 'edge';
import { adoptions, organizations, userProfiles } from '@/db/schema';
import { getDb } from '@/lib/db';
import { availableAnimalsBase, availableAnimalsOrder } from '@/lib/showcase';
import { getContractBaseUrl } from '@/lib/contractUrl';
import { isNotNull } from 'drizzle-orm';

/**
 * Sitemap for Google + social crawlers (v2.14.10-4).
 *
 * Lists the three showcase root URLs + every available animal + every org
 * + every user with a handle. The Vite SPA's per-page meta tags ride along
 * once a crawler fetches each URL, but the sitemap gives Google a flat
 * discovery surface so the SPA's slower-than-SSR meta indexing doesn't
 * matter for discovery.
 *
 * Cache: 24h. Animals come and go but a one-day window is enough.
 *
 * Resolves the Vite-app base URL at request time via `getContractBaseUrl`
 * (reads `CONTRACT_BASE_URL` from the Cloudflare worker binding) so staging
 * and production each point at their own Vite deployment.
 */

export async function GET() {
    const CONTRACT_BASE = await getContractBaseUrl();
    const urls: { loc: string; lastmod?: string }[] = [];

    // Roots
    urls.push({ loc: `${CONTRACT_BASE}/` });

    try {
        const db = await getDb();
        if (db) {
            // All organizations with a slug
            const orgs = await db.select({ slug: organizations.slug })
                .from(organizations)
                .where(isNotNull(organizations.slug))
                .all() as { slug: string | null }[];
            for (const o of orgs) {
                if (o.slug) urls.push({ loc: `${CONTRACT_BASE}/org/${encodeURIComponent(o.slug)}` });
            }

            // All users with a handle
            const handles = await db.select({ handle: userProfiles.handle })
                .from(userProfiles)
                .where(isNotNull(userProfiles.handle))
                .all() as { handle: string | null }[];
            for (const u of handles) {
                if (u.handle) urls.push({ loc: `${CONTRACT_BASE}/user/${encodeURIComponent(u.handle)}` });
            }

            // All available animals (cap at 5000 to keep sitemap under Google's 50k/50MB limit)
            const animals = await db.select({ id: adoptions.id, date: adoptions.date })
                .from(adoptions)
                .where(availableAnimalsBase())
                .orderBy(availableAnimalsOrder())
                .limit(5000)
                .all() as { id: string; date: Date | null }[];
            for (const a of animals) {
                urls.push({
                    loc: `${CONTRACT_BASE}/animal/${encodeURIComponent(a.id)}`,
                    lastmod: a.date ? a.date.toISOString() : undefined,
                });
            }
        }
    } catch {
        // Fall through with just the root — partial sitemap is better than no sitemap.
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n')}
</urlset>`;

    return new Response(xml, {
        headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=86400, stale-while-revalidate=86400',
        },
    });
}
