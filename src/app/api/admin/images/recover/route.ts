export const runtime = 'edge';

import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { auth } from '@/auth';
import { isAdminAsync } from '@/config/admins';
import { uploadToR2 } from '@/lib/r2';

/**
 * Recovery endpoint for expired Facebook images.
 * Uses facebookexternalhit UA to get OG images, downloads to R2.
 * If R2 download fails, saves the fresh OG URL directly (still better than the expired one).
 */

export async function GET() {
    const session = await auth();
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { env } = getRequestContext();
    if (!env?.DB) return NextResponse.json({ error: 'No database' }, { status: 500 });

    // First, undo any 'unrecoverable:' marks from previous runs so we can retry
    await env.DB.prepare(`
        UPDATE adopter_images SET url = REPLACE(url, 'unrecoverable:', '')
        WHERE url LIKE 'unrecoverable:%'
    `).run();

    const recoverable = await env.DB.prepare(`
        SELECT DISTINCT 
            ai.adopter_id,
            a.name as adopter_name,
            COUNT(DISTINCT ai.id) as broken_image_count,
            GROUP_CONCAT(DISTINCT ad.source_url) as source_urls
        FROM adopter_images ai
        JOIN adopters a ON a.id = ai.adopter_id
        LEFT JOIN adoptions ad ON ad.adopter_id = ai.adopter_id AND ad.source_url IS NOT NULL AND ad.source_url != ''
        WHERE ai.url NOT LIKE '%r2.dev%'
          AND (ai.url LIKE 'broken:%' OR ai.url LIKE '%scontent%' OR ai.url LIKE '%fbcdn%' OR ai.url LIKE '%fbsbx%' OR ai.url LIKE '%lookaside%')
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

const FB_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

/** Fetch a Facebook post and extract og:image URLs */
async function extractOgImages(fbUrl: string): Promise<string[]> {
    const response = await fetch(fbUrl, {
        headers: { 'User-Agent': FB_UA, 'Accept': 'text/html' },
        redirect: 'follow',
    });

    if (!response.ok) return [];

    const html = await response.text();
    const images: string[] = [];

    const patterns = [
        /<meta\s+property="og:image"\s+content="([^"]+)"/gi,
        /<meta\s+content="([^"]+)"\s+property="og:image"/gi,
    ];
    for (const regex of patterns) {
        let match;
        while ((match = regex.exec(html)) !== null) {
            const imgUrl = match[1].replace(/&amp;/g, '&');
            if (imgUrl && !images.includes(imgUrl)) {
                images.push(imgUrl);
            }
        }
    }

    return images;
}

/** Try downloading image with multiple UA/header combos */
async function tryDownloadImage(imgUrl: string): Promise<{ data?: ArrayBuffer; contentType?: string; error?: string; status?: number; finalUrl?: string }> {
    // Try multiple header combinations
    const attempts: Array<{ name: string; headers: Record<string, string> }> = [
        {
            name: 'facebookexternalhit+referer',
            headers: {
                'User-Agent': FB_UA,
                'Accept': 'image/*,*/*',
                'Referer': 'https://www.facebook.com/',
            }
        },
        {
            name: 'browser+referer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                'Referer': 'https://www.facebook.com/',
                'Sec-Fetch-Dest': 'image',
                'Sec-Fetch-Mode': 'no-cors',
                'Sec-Fetch-Site': 'cross-site',
            }
        },
        {
            name: 'googlebot',
            headers: {
                'User-Agent': 'Googlebot-Image/1.0',
                'Accept': 'image/*,*/*',
            }
        },
    ];

    for (const attempt of attempts) {
        try {
            const response = await fetch(imgUrl, {
                headers: attempt.headers,
                redirect: 'follow',
            });

            const contentType = response.headers.get('content-type') || '';

            if (!response.ok) {
                continue; // Try next attempt
            }

            // If we got HTML (login page), skip
            if (contentType.includes('text/html')) {
                continue;
            }

            const data = await response.arrayBuffer();

            // Skip tiny responses (error pages, 1x1 pixels)
            if (data.byteLength < 500) {
                continue;
            }

            return {
                data,
                contentType: contentType || 'image/jpeg',
                finalUrl: response.url,
            };
        } catch {
            continue;
        }
    }

    // All attempts failed — try one more time just to get error details
    try {
        const lastResponse = await fetch(imgUrl, {
            headers: { 'User-Agent': FB_UA, 'Referer': 'https://www.facebook.com/' },
            redirect: 'follow',
        });
        return {
            error: `All download attempts failed. Last: HTTP ${lastResponse.status}, type=${lastResponse.headers.get('content-type')}, url=${lastResponse.url.substring(0, 80)}`,
            status: lastResponse.status,
        };
    } catch (e) {
        return { error: `All download attempts failed: ${String(e)}` };
    }
}

export async function POST(request: Request) {
    const session = await auth();
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { env } = getRequestContext();
    if (!env?.DB) return NextResponse.json({ error: 'No database' }, { status: 500 });

    const body = await request.json() as { adopterId?: string; offset?: number };
    const offset = body.offset || 0;

    // Get ONE adopter, using offset to skip already-processed ones
    let stmt;
    if (body.adopterId) {
        stmt = env.DB.prepare(`
            SELECT DISTINCT ai.adopter_id, a.name as adopter_name, GROUP_CONCAT(DISTINCT ad.source_url) as source_urls
            FROM adopter_images ai
            JOIN adopters a ON a.id = ai.adopter_id
            LEFT JOIN adoptions ad ON ad.adopter_id = ai.adopter_id AND ad.source_url IS NOT NULL AND ad.source_url != ''
            WHERE ai.adopter_id = ?
              AND ai.url NOT LIKE '%r2.dev%'
              AND (ai.url LIKE 'broken:%' OR ai.url LIKE '%scontent%' OR ai.url LIKE '%fbcdn%' OR ai.url LIKE '%fbsbx%')
            GROUP BY ai.adopter_id LIMIT 1
        `).bind(body.adopterId);
    } else {
        stmt = env.DB.prepare(`
            SELECT DISTINCT ai.adopter_id, a.name as adopter_name, GROUP_CONCAT(DISTINCT ad.source_url) as source_urls
            FROM adopter_images ai
            JOIN adopters a ON a.id = ai.adopter_id
            LEFT JOIN adoptions ad ON ad.adopter_id = ai.adopter_id AND ad.source_url IS NOT NULL AND ad.source_url != ''
            WHERE ai.url NOT LIKE '%r2.dev%'
              AND (ai.url LIKE 'broken:%' OR ai.url LIKE '%scontent%' OR ai.url LIKE '%fbcdn%' OR ai.url LIKE '%fbsbx%')
            GROUP BY ai.adopter_id
            HAVING source_urls IS NOT NULL
            LIMIT 1 OFFSET ?
        `).bind(offset);
    }

    const adopter = await stmt.first<{
        adopter_id: string;
        adopter_name: string;
        source_urls: string | null;
    }>();

    if (!adopter) {
        return NextResponse.json({ done: true, message: 'No more adopters to recover' });
    }

    if (!adopter.source_urls) {
        return NextResponse.json({
            adopterId: adopter.adopter_id,
            adopterName: adopter.adopter_name,
            error: 'No source URL',
            imagesFound: 0,
            imagesSaved: 0,
            nextOffset: offset + 1,
        });
    }

    const sourceUrl = adopter.source_urls.split(',').filter(Boolean)[0];
    const ogImages = await extractOgImages(sourceUrl);

    // If no OG images found, try the next source URL
    if (ogImages.length === 0 && adopter.source_urls.split(',').filter(Boolean).length > 1) {
        const altUrl = adopter.source_urls.split(',').filter(Boolean)[1];
        const altImages = await extractOgImages(altUrl);
        ogImages.push(...altImages);
    }

    let savedToR2 = 0;
    let savedFreshUrl = 0;
    const details: unknown[] = [];

    for (const imgUrl of ogImages) {
        const download = await tryDownloadImage(imgUrl);

        if (download.data) {
            // Successfully downloaded — upload to R2!
            try {
                let ext = 'jpg';
                if (download.contentType?.includes('png')) ext = 'png';
                else if (download.contentType?.includes('webp')) ext = 'webp';

                const imageId = crypto.randomUUID();
                const key = `adopters/${adopter.adopter_id}/${imageId}.${ext}`;
                const r2Url = await uploadToR2(key, download.data, download.contentType || 'image/jpeg');

                // Update a broken DB record
                const brokenImage = await env.DB.prepare(`
                    SELECT id FROM adopter_images 
                    WHERE adopter_id = ? AND url NOT LIKE '%r2.dev%'
                      AND (url LIKE 'broken:%' OR url LIKE '%scontent%' OR url LIKE '%fbcdn%' OR url LIKE '%fbsbx%')
                    LIMIT 1
                `).bind(adopter.adopter_id).first<{ id: string }>();

                if (brokenImage) {
                    await env.DB.prepare(`UPDATE adopter_images SET url = ? WHERE id = ?`).bind(r2Url, brokenImage.id).run();
                }
                savedToR2++;
                details.push({ imgUrl: imgUrl.substring(0, 80), status: 'r2', size: download.data.byteLength, r2Url });
            } catch (e) {
                details.push({ imgUrl: imgUrl.substring(0, 80), status: 'r2_upload_failed', error: String(e) });
            }
        } else {
            // Download failed — save fresh OG URL directly (better than expired)
            const brokenImage = await env.DB.prepare(`
                SELECT id FROM adopter_images 
                WHERE adopter_id = ? AND url NOT LIKE '%r2.dev%'
                  AND (url LIKE 'broken:%' OR url LIKE '%scontent%' OR url LIKE '%fbcdn%' OR url LIKE '%fbsbx%')
                LIMIT 1
            `).bind(adopter.adopter_id).first<{ id: string }>();

            if (brokenImage) {
                await env.DB.prepare(`UPDATE adopter_images SET url = ? WHERE id = ?`).bind(imgUrl, brokenImage.id).run();
                savedFreshUrl++;
            }
            details.push({ imgUrl: imgUrl.substring(0, 80), status: 'fresh_url_fallback', downloadError: download.error });
        }
    }

    // Count remaining
    const remaining = await env.DB.prepare(`
        SELECT COUNT(DISTINCT ai.adopter_id) as count
        FROM adopter_images ai
        JOIN adoptions ad ON ad.adopter_id = ai.adopter_id AND ad.source_url IS NOT NULL AND ad.source_url != ''
        WHERE ai.url NOT LIKE '%r2.dev%'
          AND (ai.url LIKE 'broken:%' OR ai.url LIKE '%scontent%' OR ai.url LIKE '%fbcdn%' OR ai.url LIKE '%fbsbx%')
    `).first<{ count: number }>();

    return NextResponse.json({
        adopterId: adopter.adopter_id,
        adopterName: adopter.adopter_name,
        sourceUrl,
        ogImagesFound: ogImages.length,
        savedToR2,
        savedFreshUrl,
        remaining: remaining?.count || 0,
        nextOffset: (savedToR2 === 0 && savedFreshUrl === 0) ? offset + 1 : 0,
        details,
    });
}
