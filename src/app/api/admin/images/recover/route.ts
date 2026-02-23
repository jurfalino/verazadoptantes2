export const runtime = 'edge';

import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { auth } from '@/auth';
import { isAdminAsync } from '@/config/admins';
import { persistImageToR2 } from '@/lib/r2';

/**
 * Recovery endpoint for expired Facebook images.
 * 
 * Uses facebookexternalhit user agent to fetch OG meta images directly from
 * Facebook posts — no Playwright/scraper needed. Facebook always serves
 * og:image tags to its own crawler UA.
 * 
 * GET  - Returns adopters with broken images and recoverable source URLs
 * POST - Recovers one adopter: fetches Facebook post HTML, extracts og:image, downloads to R2
 */

export async function GET() {
    const session = await auth();
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { env } = getRequestContext();
    if (!env?.DB) return NextResponse.json({ error: 'No database' }, { status: 500 });

    const recoverable = await env.DB.prepare(`
        SELECT DISTINCT 
            ai.adopter_id,
            a.name as adopter_name,
            COUNT(DISTINCT ai.id) as broken_image_count,
            GROUP_CONCAT(DISTINCT ad.source_url) as source_urls
        FROM adopter_images ai
        JOIN adopters a ON a.id = ai.adopter_id
        LEFT JOIN adoptions ad ON ad.adopter_id = ai.adopter_id AND ad.source_url IS NOT NULL AND ad.source_url != ''
        WHERE (ai.url LIKE 'broken:%' OR (ai.url LIKE '%scontent%' OR ai.url LIKE '%fbcdn%' OR ai.url LIKE '%fbsbx%' OR ai.url LIKE '%lookaside%'))
          AND ai.url NOT LIKE '%r2.dev%'
        GROUP BY ai.adopter_id
    `).all<{
        adopter_id: string;
        adopter_name: string;
        broken_image_count: number;
        source_urls: string | null;
    }>();

    const withSource = recoverable.results.filter(r => r.source_urls);
    const withoutSource = recoverable.results.filter(r => !r.source_urls);

    return NextResponse.json({
        total_adopters_affected: recoverable.results.length,
        recoverable: withSource.length,
        no_source_url: withoutSource.length,
        adopters_with_source: withSource,
        adopters_without_source: withoutSource,
    });
}

/**
 * Fetch a Facebook post using facebookexternalhit UA and extract og:image URLs.
 * Facebook always serves OG tags to its own crawler — no login wall, no Playwright.
 */
async function extractOgImages(fbUrl: string): Promise<string[]> {
    const response = await fetch(fbUrl, {
        headers: {
            'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
            'Accept': 'text/html',
        },
        redirect: 'follow',
    });

    if (!response.ok) {
        console.log(`[Recovery] Facebook returned ${response.status} for ${fbUrl}`);
        return [];
    }

    const html = await response.text();
    const images: string[] = [];

    // Extract all og:image meta tags
    const ogImageRegex = /<meta\s+property="og:image"\s+content="([^"]+)"/gi;
    let match;
    while ((match = ogImageRegex.exec(html)) !== null) {
        let imgUrl = match[1].replace(/&amp;/g, '&');
        if (imgUrl && !images.includes(imgUrl)) {
            images.push(imgUrl);
        }
    }

    // Also try content before property (Facebook sometimes reverses attribute order)
    const altRegex = /<meta\s+content="([^"]+)"\s+property="og:image"/gi;
    while ((match = altRegex.exec(html)) !== null) {
        let imgUrl = match[1].replace(/&amp;/g, '&');
        if (imgUrl && !images.includes(imgUrl)) {
            images.push(imgUrl);
        }
    }

    console.log(`[Recovery] Extracted ${images.length} OG images from ${fbUrl}`);
    return images;
}

export async function POST(request: Request) {
    const session = await auth();
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { env } = getRequestContext();
    if (!env?.DB) return NextResponse.json({ error: 'No database' }, { status: 500 });

    const body = await request.json() as { adopterId?: string };

    // Get ONE adopter to recover
    let stmt;
    if (body.adopterId) {
        stmt = env.DB.prepare(`
            SELECT DISTINCT ai.adopter_id, a.name as adopter_name, GROUP_CONCAT(DISTINCT ad.source_url) as source_urls
            FROM adopter_images ai
            JOIN adopters a ON a.id = ai.adopter_id
            LEFT JOIN adoptions ad ON ad.adopter_id = ai.adopter_id AND ad.source_url IS NOT NULL AND ad.source_url != ''
            WHERE ai.adopter_id = ?
              AND (ai.url LIKE 'broken:%' OR ai.url LIKE '%scontent%' OR ai.url LIKE '%fbcdn%' OR ai.url LIKE '%fbsbx%')
              AND ai.url NOT LIKE '%r2.dev%'
            GROUP BY ai.adopter_id
            LIMIT 1
        `).bind(body.adopterId);
    } else {
        stmt = env.DB.prepare(`
            SELECT DISTINCT ai.adopter_id, a.name as adopter_name, GROUP_CONCAT(DISTINCT ad.source_url) as source_urls
            FROM adopter_images ai
            JOIN adopters a ON a.id = ai.adopter_id
            LEFT JOIN adoptions ad ON ad.adopter_id = ai.adopter_id AND ad.source_url IS NOT NULL AND ad.source_url != ''
            WHERE (ai.url LIKE 'broken:%' OR ai.url LIKE '%scontent%' OR ai.url LIKE '%fbcdn%' OR ai.url LIKE '%fbsbx%')
              AND ai.url NOT LIKE '%r2.dev%'
            GROUP BY ai.adopter_id
            HAVING source_urls IS NOT NULL
            LIMIT 1
        `);
    }

    const result = await stmt.first<{
        adopter_id: string;
        adopter_name: string;
        source_urls: string | null;
    }>();

    if (!result) {
        return NextResponse.json({ message: 'No more adopters to recover', done: true });
    }

    if (!result.source_urls) {
        return NextResponse.json({
            adopterId: result.adopter_id,
            adopterName: result.adopter_name,
            error: 'No source URL',
            imagesFound: 0,
            imagesSaved: 0,
        });
    }

    const urls = [...new Set(result.source_urls.split(',').filter(Boolean))];
    let totalFound = 0;
    let totalSaved = 0;
    const imageResults: Array<{ source: string; found: number; saved: number }> = [];

    for (const sourceUrl of urls) {
        // Fetch OG images directly via HTTP (no Playwright!)
        const ogImages = await extractOgImages(sourceUrl);
        totalFound += ogImages.length;

        let saved = 0;
        for (const imgUrl of ogImages) {
            const imageId = crypto.randomUUID();
            const r2Url = await persistImageToR2(imgUrl, result.adopter_id, imageId);

            if (r2Url) {
                const brokenImage = await env.DB.prepare(`
                    SELECT id FROM adopter_images 
                    WHERE adopter_id = ? 
                      AND (url LIKE 'broken:%' OR url LIKE '%scontent%' OR url LIKE '%fbcdn%' OR url LIKE '%fbsbx%')
                      AND url NOT LIKE '%r2.dev%'
                    LIMIT 1
                `).bind(result.adopter_id).first<{ id: string }>();

                if (brokenImage) {
                    await env.DB.prepare(
                        `UPDATE adopter_images SET url = ?, caption = REPLACE(COALESCE(caption, ''), ' [broken: original expired]', '') WHERE id = ?`
                    ).bind(r2Url, brokenImage.id).run();
                } else {
                    await env.DB.prepare(`
                        INSERT INTO adopter_images (id, adopter_id, url, caption, added_by)
                        VALUES (?, ?, ?, 'Recovered from Facebook', ?)
                    `).bind(imageId, result.adopter_id, r2Url, session.user.email).run();
                }
                saved++;
            }
        }
        totalSaved += saved;
        imageResults.push({ source: sourceUrl, found: ogImages.length, saved });
    }

    // Count remaining
    const remaining = await env.DB.prepare(`
        SELECT COUNT(DISTINCT ai.adopter_id) as count
        FROM adopter_images ai
        JOIN adoptions ad ON ad.adopter_id = ai.adopter_id AND ad.source_url IS NOT NULL AND ad.source_url != ''
        WHERE (ai.url LIKE 'broken:%' OR ai.url LIKE '%scontent%' OR ai.url LIKE '%fbcdn%' OR ai.url LIKE '%fbsbx%')
          AND ai.url NOT LIKE '%r2.dev%'
    `).first<{ count: number }>();

    return NextResponse.json({
        adopterId: result.adopter_id,
        adopterName: result.adopter_name,
        imagesFound: totalFound,
        imagesSaved: totalSaved,
        imageResults,
        remaining: remaining?.count || 0,
    });
}
