export const runtime = 'edge';

import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { auth } from '@/auth';
import { isAdminAsync } from '@/config/admins';
import { persistImageToR2 } from '@/lib/r2';

/**
 * Simple endpoint: takes image URLs, downloads them to R2, updates adopter records.
 * Designed to be called from the browser after the browser has already scraped
 * fresh image URLs from Facebook (avoiding edge function timeouts).
 * 
 * POST { adopterId, imageUrls: string[] }
 */
export async function POST(request: Request) {
    const session = await auth();
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { env } = getRequestContext();
    if (!env?.DB) return NextResponse.json({ error: 'No database' }, { status: 500 });

    const body = await request.json() as { adopterId: string; imageUrls: string[] };
    if (!body.adopterId || !body.imageUrls?.length) {
        return NextResponse.json({ error: 'Missing adopterId or imageUrls' }, { status: 400 });
    }

    const results: Array<{ url: string; status: string; r2Url?: string; error?: string }> = [];

    for (const imgUrl of body.imageUrls) {
        try {
            const imageId = crypto.randomUUID();
            const r2Url = await persistImageToR2(imgUrl, body.adopterId, imageId);

            if (r2Url) {
                // Find a broken/expired image record and update it
                const brokenImage = await env.DB.prepare(`
                    SELECT id FROM adopter_images 
                    WHERE adopter_id = ? 
                      AND (url LIKE 'broken:%' OR url LIKE '%scontent%' OR url LIKE '%fbcdn%' OR url LIKE '%fbsbx%' OR url LIKE '%lookaside%')
                      AND url NOT LIKE '%r2.dev%'
                    LIMIT 1
                `).bind(body.adopterId).first<{ id: string }>();

                if (brokenImage) {
                    await env.DB.prepare(
                        `UPDATE adopter_images SET url = ?, caption = REPLACE(COALESCE(caption, ''), ' [broken: original expired]', '') WHERE id = ?`
                    ).bind(r2Url, brokenImage.id).run();
                    results.push({ url: imgUrl.substring(0, 80), status: 'updated', r2Url });
                } else {
                    await env.DB.prepare(`
                        INSERT INTO adopter_images (id, adopter_id, url, caption, added_by)
                        VALUES (?, ?, ?, 'Recovered from Facebook', ?)
                    `).bind(imageId, body.adopterId, r2Url, session.user.email).run();
                    results.push({ url: imgUrl.substring(0, 80), status: 'inserted', r2Url });
                }
            } else {
                results.push({ url: imgUrl.substring(0, 80), status: 'download_failed', error: 'Could not download image' });
            }
        } catch (error) {
            results.push({ url: imgUrl.substring(0, 80), status: 'error', error: String(error) });
        }
    }

    return NextResponse.json({
        adopterId: body.adopterId,
        processed: body.imageUrls.length,
        saved: results.filter(r => r.status === 'updated' || r.status === 'inserted').length,
        results,
    });
}
