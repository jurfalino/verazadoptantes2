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
 * POST - Runs recovery for a batch of adopters
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

    const body = await request.json() as { adopterId?: string; batchSize?: number };
    const batchSize = Math.min(body.batchSize || 5, 20);

    // Get adopters to recover
    let query: string;
    let binds: string[];

    if (body.adopterId) {
        query = `
            SELECT DISTINCT ai.adopter_id, GROUP_CONCAT(DISTINCT ad.source_url) as source_urls
            FROM adopter_images ai
            LEFT JOIN adoptions ad ON ad.adopter_id = ai.adopter_id AND ad.source_url IS NOT NULL AND ad.source_url != ''
            WHERE ai.adopter_id = ?
              AND (ai.url LIKE 'broken:%' OR (ai.url LIKE '%scontent%' OR ai.url LIKE '%fbcdn%' OR ai.url LIKE '%fbsbx%'))
              AND ai.url NOT LIKE '%r2.dev%'
            GROUP BY ai.adopter_id
        `;
        binds = [body.adopterId];
    } else {
        query = `
            SELECT DISTINCT ai.adopter_id, GROUP_CONCAT(DISTINCT ad.source_url) as source_urls
            FROM adopter_images ai
            LEFT JOIN adoptions ad ON ad.adopter_id = ai.adopter_id AND ad.source_url IS NOT NULL AND ad.source_url != ''
            WHERE (ai.url LIKE 'broken:%' OR (ai.url LIKE '%scontent%' OR ai.url LIKE '%fbcdn%' OR ai.url LIKE '%fbsbx%'))
              AND ai.url NOT LIKE '%r2.dev%'
            GROUP BY ai.adopter_id
            HAVING source_urls IS NOT NULL
            LIMIT ?
        `;
        binds = [String(batchSize)];
    }

    const stmt = env.DB.prepare(query);
    const adopters = await (binds.length === 1 ? stmt.bind(binds[0]) : stmt).all<{
        adopter_id: string;
        source_urls: string | null;
    }>();

    const results: Array<{
        adopterId: string;
        sourceUrl: string;
        scraped: boolean;
        imagesFound: number;
        imagesSaved: number;
        error?: string;
    }> = [];

    for (const adopter of adopters.results) {
        if (!adopter.source_urls) {
            results.push({
                adopterId: adopter.adopter_id,
                sourceUrl: '',
                scraped: false,
                imagesFound: 0,
                imagesSaved: 0,
                error: 'No source URL available'
            });
            continue;
        }

        // Process each unique source URL for this adopter
        const urls = [...new Set(adopter.source_urls.split(',').filter(Boolean))];

        for (const sourceUrl of urls) {
            try {
                // Re-scrape the Facebook post via the Playwright scraper
                const scrapeResponse = await fetch(`${SCRAPER_URL}/scrape`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: sourceUrl }),
                });

                if (!scrapeResponse.ok) {
                    results.push({
                        adopterId: adopter.adopter_id,
                        sourceUrl,
                        scraped: false,
                        imagesFound: 0,
                        imagesSaved: 0,
                        error: `Scraper returned ${scrapeResponse.status}`
                    });
                    continue;
                }

                const scrapeData = await scrapeResponse.json() as {
                    success: boolean;
                    images?: string[];
                    error?: string;
                };

                if (!scrapeData.success || !scrapeData.images?.length) {
                    results.push({
                        adopterId: adopter.adopter_id,
                        sourceUrl,
                        scraped: true,
                        imagesFound: 0,
                        imagesSaved: 0,
                        error: scrapeData.error || 'No images found in post'
                    });
                    continue;
                }

                // Download each fresh image and upload to R2
                let savedCount = 0;
                for (const imgUrl of scrapeData.images) {
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
                            // Update existing broken record with the new R2 URL
                            await env.DB.prepare(
                                `UPDATE adopter_images SET url = ?, caption = REPLACE(COALESCE(caption, ''), ' [broken: original expired]', '') WHERE id = ?`
                            ).bind(r2Url, brokenImage.id).run();
                        } else {
                            // All broken records already recovered — insert as new
                            await env.DB.prepare(`
                                INSERT INTO adopter_images (id, adopter_id, url, caption, added_by)
                                VALUES (?, ?, ?, 'Recovered from Facebook', ?)
                            `).bind(imageId, adopter.adopter_id, r2Url, session.user.email).run();
                        }
                        savedCount++;
                    }
                }

                results.push({
                    adopterId: adopter.adopter_id,
                    sourceUrl,
                    scraped: true,
                    imagesFound: scrapeData.images.length,
                    imagesSaved: savedCount,
                });
            } catch (error) {
                results.push({
                    adopterId: adopter.adopter_id,
                    sourceUrl,
                    scraped: false,
                    imagesFound: 0,
                    imagesSaved: 0,
                    error: String(error)
                });
            }
        }
    }

    const totalRecovered = results.reduce((sum, r) => sum + r.imagesSaved, 0);
    const totalFound = results.reduce((sum, r) => sum + r.imagesFound, 0);

    return NextResponse.json({
        processed: adopters.results.length,
        total_images_found: totalFound,
        total_images_recovered: totalRecovered,
        results,
        hasMore: adopters.results.length === batchSize
    });
}
