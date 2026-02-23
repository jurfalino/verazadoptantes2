export const runtime = 'edge';

import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { auth } from '@/auth';
import { isAdminAsync } from '@/config/admins';

/**
 * Simple recovery endpoint.
 * 
 * GET  - Returns ALL adopters that have a Facebook source_url on their adoption records.
 *        The browser script uses this list to scrape fresh images via fetch-post.
 * 
 * POST { adopterId, imageUrls } - Deletes ALL old images for the adopter, 
 *        downloads the new ones to R2, and saves them.
 */

export async function GET() {
    const session = await auth();
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { env } = getRequestContext();
    if (!env?.DB) return NextResponse.json({ error: 'No database' }, { status: 500 });

    // Get ALL adopters with a facebook source_url — regardless of image status
    const adopters = await env.DB.prepare(`
        SELECT DISTINCT 
            ad.adopter_id,
            a.name as adopter_name,
            GROUP_CONCAT(DISTINCT ad.source_url) as source_urls,
            (SELECT COUNT(*) FROM adopter_images ai WHERE ai.adopter_id = ad.adopter_id) as image_count
        FROM adoptions ad
        JOIN adopters a ON a.id = ad.adopter_id
        WHERE ad.source_url IS NOT NULL 
          AND ad.source_url != ''
          AND ad.source_url LIKE '%facebook.com%'
        GROUP BY ad.adopter_id
        ORDER BY a.name
    `).all<{
        adopter_id: string;
        adopter_name: string;
        source_urls: string;
        image_count: number;
    }>();

    return NextResponse.json({
        total: adopters.results.length,
        adopters: adopters.results,
    });
}
