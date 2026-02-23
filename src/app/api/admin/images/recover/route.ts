export const runtime = 'edge';

import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { auth } from '@/auth';
import { isAdminAsync } from '@/config/admins';
import { persistImageToR2 } from '@/lib/r2';

/**
 * Recovery endpoint for expired Facebook images.
 * 
 * Strategy: For each adopter with broken images, find their adoption source_url
 * (the original Facebook post), re-scrape it via the Playwright scraper to get
 * fresh CDN URLs, then immediately download and upload to R2.
 * 
 * GET  - Returns adopters that have broken images and recoverable source URLs
 * POST - Recovers ONE adopter at a time (to avoid Cloudflare edge timeouts)
 */

const SCRAPER_URL = process.env.SCRAPER_URL || 'https://facebook-scraper.fly.dev';

export async function GET() {
    const session = await auth();
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { env } = getRequestContext();
    if (!env?.DB) return NextResponse.json({ error: 'No database' }, { status: 500 });

    // Find adopters with broken/expired images that have a source_url on their adoption records
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

export async function POST(request: Request) {
    const session = await auth();
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { env } = getRequestContext();
    if (!env?.DB) return NextResponse.json({ error: 'No database' }, { status: 500 });

    const body = await request.json() as { adopterId?: string };

    // Process ONE adopter at a time to stay within Cloudflare edge timeout
    let query: string;
    let bindValue: string | undefined;

    if (body.adopterId) {
        query = `
            SELECT DISTINCT ai.adopter_id, GROUP_CONCAT(DISTINCT ad.source_url) as source_urls
            FROM adopter_images ai
            LEFT JOIN adoptions ad ON ad.adopter_id = ai.adopter_id AND ad.source_url IS NOT NULL AND ad.source_url != ''
            WHERE ai.adopter_id = ?
              AND (ai.url LIKE 'broken:%' OR (ai.url LIKE '%scontent%' OR ai.url LIKE '%fbcdn%' OR ai.url LIKE '%fbsbx%'))
              AND ai.url NOT LIKE '%r2.dev%'
            GROUP BY ai.adopter_id
            LIMIT 1
        `;
        bindValue = body.adopterId;
    } else {
        query = `
            SELECT DISTINCT ai.adopter_id, GROUP_CONCAT(DISTINCT ad.source_url) as source_urls
            FROM adopter_images ai
            LEFT JOIN adoptions ad ON ad.adopter_id = ai.adopter_id AND ad.source_url IS NOT NULL AND ad.source_url != ''
            WHERE (ai.url LIKE 'broken:%' OR (ai.url LIKE '%scontent%' OR ai.url LIKE '%fbcdn%' OR ai.url LIKE '%fbsbx%'))
              AND ai.url NOT LIKE '%r2.dev%'
            GROUP BY ai.adopter_id
            HAVING source_urls IS NOT NULL
            LIMIT 1
        `;
    }

    const stmt = bindValue ? env.DB.prepare(query).bind(bindValue) : env.DB.prepare(query);
    const adopters = await stmt.all<{
        adopter_id: string;
        source_urls: string | null;
    }>();

    if (adopters.results.length === 0) {
        return NextResponse.json({
            message: 'No more adopters to recover',
            processed: 0,
            total_images_found: 0,
            total_images_recovered: 0,
        });
    }

    const adopter = adopters.results[0];

    if (!adopter.source_urls) {
        return NextResponse.json({
            message: 'Adopter has no source URL for recovery',
            adopterId: adopter.adopter_id,
            processed: 1,
            total_images_found: 0,
            total_images_recovered: 0,
        });
    }

    // Use only the FIRST source URL to keep request fast
    const sourceUrl = adopter.source_urls.split(',').filter(Boolean)[0];

    try {
        // Re-scrape the Facebook post via the Playwright scraper (with 25s timeout)
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 25000);

        const scrapeResponse = await fetch(`${SCRAPER_URL}/scrape`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: sourceUrl }),
            signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!scrapeResponse.ok) {
            return NextResponse.json({
                adopterId: adopter.adopter_id,
                sourceUrl,
                error: `Scraper returned ${scrapeResponse.status}`,
                processed: 1,
                total_images_found: 0,
                total_images_recovered: 0,
            });
        }

        const scrapeData = await scrapeResponse.json() as {
            success: boolean;
            data?: { text?: string; author?: string; images?: string[] };
            images?: string[];
            error?: string;
        };

        const scrapedImages = scrapeData.data?.images || scrapeData.images || [];

        if (!scrapeData.success || scrapedImages.length === 0) {
            return NextResponse.json({
                adopterId: adopter.adopter_id,
                sourceUrl,
                scraped: true,
                error: scrapeData.error || 'No images found in post',
                processed: 1,
                total_images_found: 0,
                total_images_recovered: 0,
            });
        }

        // Download each fresh image and upload to R2
        let savedCount = 0;
        const imageResults: Array<{ url: string; status: string; r2Url?: string }> = [];

        for (const imgUrl of scrapedImages) {
            const imageId = crypto.randomUUID();
            const r2Url = await persistImageToR2(imgUrl, adopter.adopter_id, imageId);

            if (r2Url) {
                // Find a broken image record for this adopter and update it
                const brokenImage = await env.DB.prepare(`
                    SELECT id FROM adopter_images 
                    WHERE adopter_id = ? 
                      AND (url LIKE 'broken:%' OR (url LIKE '%scontent%' OR url LIKE '%fbcdn%' OR url LIKE '%fbsbx%'))
                      AND url NOT LIKE '%r2.dev%'
                    LIMIT 1
                `).bind(adopter.adopter_id).first<{ id: string }>();

                if (brokenImage) {
                    await env.DB.prepare(
                        `UPDATE adopter_images SET url = ?, caption = REPLACE(COALESCE(caption, ''), ' [broken: original expired]', '') WHERE id = ?`
                    ).bind(r2Url, brokenImage.id).run();
                } else {
                    await env.DB.prepare(`
                        INSERT INTO adopter_images (id, adopter_id, url, caption, added_by)
                        VALUES (?, ?, ?, 'Recovered from Facebook', ?)
                    `).bind(imageId, adopter.adopter_id, r2Url, session.user.email).run();
                }
                savedCount++;
                imageResults.push({ url: imgUrl.substring(0, 60), status: 'saved', r2Url });
            } else {
                imageResults.push({ url: imgUrl.substring(0, 60), status: 'download_failed' });
            }
        }

        // Count remaining
        const remaining = await env.DB.prepare(`
            SELECT COUNT(DISTINCT ai.adopter_id) as count
            FROM adopter_images ai
            LEFT JOIN adoptions ad ON ad.adopter_id = ai.adopter_id AND ad.source_url IS NOT NULL
            WHERE (ai.url LIKE 'broken:%' OR (ai.url LIKE '%scontent%' OR ai.url LIKE '%fbcdn%' OR ai.url LIKE '%fbsbx%'))
              AND ai.url NOT LIKE '%r2.dev%'
              AND ad.source_url IS NOT NULL
        `).first<{ count: number }>();

        return NextResponse.json({
            adopterId: adopter.adopter_id,
            sourceUrl,
            scraped: true,
            processed: 1,
            total_images_found: scrapedImages.length,
            total_images_recovered: savedCount,
            imageResults,
            remaining_adopters: remaining?.count || 0,
        });
    } catch (error) {
        const isTimeout = error instanceof Error && error.name === 'AbortError';
        return NextResponse.json({
            adopterId: adopter.adopter_id,
            sourceUrl,
            error: isTimeout ? 'Scraper timed out (25s limit)' : String(error),
            processed: 1,
            total_images_found: 0,
            total_images_recovered: 0,
        }, { status: isTimeout ? 504 : 500 });
    }
}
