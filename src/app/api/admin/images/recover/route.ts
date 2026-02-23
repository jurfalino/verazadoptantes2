export const runtime = 'edge';

import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { auth } from '@/auth';
import { isAdminAsync } from '@/config/admins';
import { uploadToR2 } from '@/lib/r2';

/**
 * Recovery endpoint for expired Facebook images.
 * Uses facebookexternalhit UA to get OG images, downloads them with same UA, uploads to R2.
 * Processes ONE adopter per call. If download fails, marks images as unrecoverable and moves on.
 *
 * GET  - Stats on broken images
 * POST - Recover one adopter
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
        WHERE ai.url NOT LIKE '%r2.dev%'
          AND ai.url NOT LIKE 'unrecoverable:%'
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

    // Match og:image in both attribute orders
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

/** Download an image and upload to R2. Returns { r2Url, error } */
async function downloadAndUpload(imgUrl: string, adopterId: string): Promise<{ r2Url?: string; error?: string; status?: number; contentType?: string; size?: number }> {
    try {
        // Try downloading with facebookexternalhit UA first (same UA that got the URL)
        let response = await fetch(imgUrl, {
            headers: { 'User-Agent': FB_UA, 'Accept': 'image/*,*/*' },
            redirect: 'follow',
        });

        // If Facebook blocks it, try with browser UA
        if (!response.ok) {
            response = await fetch(imgUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'image/*,*/*',
                },
                redirect: 'follow',
            });
        }

        if (!response.ok) {
            return { error: `HTTP ${response.status}`, status: response.status };
        }

        const contentType = response.headers.get('content-type') || 'image/jpeg';

        // If we got HTML back instead of an image, it's a login page
        if (contentType.includes('text/html')) {
            return { error: 'Got HTML instead of image (login wall)', contentType };
        }

        const arrayBuffer = await response.arrayBuffer();
        const size = arrayBuffer.byteLength;

        if (size < 500) {
            return { error: `Too small (${size} bytes)`, size };
        }

        // Determine extension
        let ext = 'jpg';
        if (contentType.includes('png')) ext = 'png';
        else if (contentType.includes('webp')) ext = 'webp';
        else if (contentType.includes('gif')) ext = 'gif';

        const imageId = crypto.randomUUID();
        const key = `adopters/${adopterId}/${imageId}.${ext}`;
        const r2Url = await uploadToR2(key, arrayBuffer, contentType);

        return { r2Url, size, contentType };
    } catch (error) {
        return { error: String(error) };
    }
}

export async function POST(request: Request) {
    const session = await auth();
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { env } = getRequestContext();
    if (!env?.DB) return NextResponse.json({ error: 'No database' }, { status: 500 });

    const body = await request.json() as { adopterId?: string };

    // Get ONE adopter to recover (exclude already-marked unrecoverable)
    let stmt;
    if (body.adopterId) {
        stmt = env.DB.prepare(`
            SELECT DISTINCT ai.adopter_id, a.name as adopter_name, GROUP_CONCAT(DISTINCT ad.source_url) as source_urls
            FROM adopter_images ai
            JOIN adopters a ON a.id = ai.adopter_id
            LEFT JOIN adoptions ad ON ad.adopter_id = ai.adopter_id AND ad.source_url IS NOT NULL AND ad.source_url != ''
            WHERE ai.adopter_id = ?
              AND ai.url NOT LIKE '%r2.dev%' AND ai.url NOT LIKE 'unrecoverable:%'
              AND (ai.url LIKE 'broken:%' OR ai.url LIKE '%scontent%' OR ai.url LIKE '%fbcdn%' OR ai.url LIKE '%fbsbx%')
            GROUP BY ai.adopter_id LIMIT 1
        `).bind(body.adopterId);
    } else {
        stmt = env.DB.prepare(`
            SELECT DISTINCT ai.adopter_id, a.name as adopter_name, GROUP_CONCAT(DISTINCT ad.source_url) as source_urls
            FROM adopter_images ai
            JOIN adopters a ON a.id = ai.adopter_id
            LEFT JOIN adoptions ad ON ad.adopter_id = ai.adopter_id AND ad.source_url IS NOT NULL AND ad.source_url != ''
            WHERE ai.url NOT LIKE '%r2.dev%' AND ai.url NOT LIKE 'unrecoverable:%'
              AND (ai.url LIKE 'broken:%' OR ai.url LIKE '%scontent%' OR ai.url LIKE '%fbcdn%' OR ai.url LIKE '%fbsbx%')
            GROUP BY ai.adopter_id
            HAVING source_urls IS NOT NULL
            LIMIT 1
        `);
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
        });
    }

    const sourceUrl = adopter.source_urls.split(',').filter(Boolean)[0];
    const ogImages = await extractOgImages(sourceUrl);
    const downloadResults: Array<{ imgUrl: string; result: Awaited<ReturnType<typeof downloadAndUpload>> }> = [];

    let savedCount = 0;

    for (const imgUrl of ogImages) {
        const result = await downloadAndUpload(imgUrl, adopter.adopter_id);
        downloadResults.push({ imgUrl: imgUrl.substring(0, 100), result });

        if (result.r2Url) {
            // Update a broken image record
            const brokenImage = await env.DB.prepare(`
                SELECT id FROM adopter_images 
                WHERE adopter_id = ? 
                  AND url NOT LIKE '%r2.dev%' AND url NOT LIKE 'unrecoverable:%'
                  AND (url LIKE 'broken:%' OR url LIKE '%scontent%' OR url LIKE '%fbcdn%' OR url LIKE '%fbsbx%')
                LIMIT 1
            `).bind(adopter.adopter_id).first<{ id: string }>();

            if (brokenImage) {
                await env.DB.prepare(
                    `UPDATE adopter_images SET url = ? WHERE id = ?`
                ).bind(result.r2Url, brokenImage.id).run();
            } else {
                const newId = crypto.randomUUID();
                await env.DB.prepare(
                    `INSERT INTO adopter_images (id, adopter_id, url, caption, added_by) VALUES (?, ?, ?, 'Recovered', ?)`
                ).bind(newId, adopter.adopter_id, result.r2Url, session.user.email).run();
            }
            savedCount++;
        }
    }

    // If we found images but couldn't save ANY, mark all broken images for this adopter
    // as unrecoverable so we don't loop on them forever
    if (ogImages.length > 0 && savedCount === 0) {
        await env.DB.prepare(`
            UPDATE adopter_images 
            SET url = 'unrecoverable:' || url
            WHERE adopter_id = ?
              AND url NOT LIKE '%r2.dev%' AND url NOT LIKE 'unrecoverable:%'
              AND (url LIKE 'broken:%' OR url LIKE '%scontent%' OR url LIKE '%fbcdn%' OR url LIKE '%fbsbx%')
        `).bind(adopter.adopter_id).run();
    }

    // Also if no OG images found at all, mark as unrecoverable
    if (ogImages.length === 0) {
        await env.DB.prepare(`
            UPDATE adopter_images 
            SET url = 'unrecoverable:' || url
            WHERE adopter_id = ?
              AND url NOT LIKE '%r2.dev%' AND url NOT LIKE 'unrecoverable:%'
              AND (url LIKE 'broken:%' OR url LIKE '%scontent%' OR url LIKE '%fbcdn%' OR url LIKE '%fbsbx%')
        `).bind(adopter.adopter_id).run();
    }

    // Count remaining
    const remaining = await env.DB.prepare(`
        SELECT COUNT(DISTINCT ai.adopter_id) as count
        FROM adopter_images ai
        JOIN adoptions ad ON ad.adopter_id = ai.adopter_id AND ad.source_url IS NOT NULL AND ad.source_url != ''
        WHERE ai.url NOT LIKE '%r2.dev%' AND ai.url NOT LIKE 'unrecoverable:%'
          AND (ai.url LIKE 'broken:%' OR ai.url LIKE '%scontent%' OR ai.url LIKE '%fbcdn%' OR ai.url LIKE '%fbsbx%')
    `).first<{ count: number }>();

    return NextResponse.json({
        adopterId: adopter.adopter_id,
        adopterName: adopter.adopter_name,
        sourceUrl,
        imagesFound: ogImages.length,
        imagesSaved: savedCount,
        remaining: remaining?.count || 0,
        downloadResults, // Full debugging details
    });
}
