export const runtime = 'edge';

import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { auth } from '@/auth';
import { isAdminAsync } from '@/config/admins';
import { persistImageToR2 } from '@/lib/r2';

/**
 * Admin endpoint to migrate existing Facebook CDN URLs to R2.
 * 
 * GET  - Returns stats on how many images need migration
 * POST - Runs migration in batches, returns progress
 */

export async function GET() {
    const session = await auth();
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { env } = getRequestContext();
    if (!env?.DB) return NextResponse.json({ error: 'No database' }, { status: 500 });

    // Count images by type
    const stats = await env.DB.prepare(`
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN url LIKE '%scontent%' OR url LIKE '%fbcdn%' OR url LIKE '%fbsbx%' OR url LIKE '%lookaside%' THEN 1 ELSE 0 END) as facebook_cdn,
            SUM(CASE WHEN url LIKE '%r2.dev%' THEN 1 ELSE 0 END) as r2_persisted,
            SUM(CASE WHEN url LIKE 'data:%' THEN 1 ELSE 0 END) as base64,
            SUM(CASE WHEN url LIKE '%broken%' THEN 1 ELSE 0 END) as broken
        FROM adopter_images
    `).first<{
        total: number;
        facebook_cdn: number;
        r2_persisted: number;
        base64: number;
        broken: number;
    }>();

    return NextResponse.json({
        stats,
        message: stats?.facebook_cdn
            ? `${stats.facebook_cdn} images still on Facebook CDN need migration`
            : 'All images are already migrated!'
    });
}

export async function POST(request: Request) {
    const session = await auth();
    if (!session?.user?.email || !await isAdminAsync(session.user.email)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { env } = getRequestContext();
    if (!env?.DB) return NextResponse.json({ error: 'No database' }, { status: 500 });

    const body = await request.json() as { batchSize?: number; dryRun?: boolean };
    const batchSize = Math.min(body.batchSize || 10, 50); // Max 50 per batch
    const dryRun = body.dryRun || false;

    // Get batch of Facebook CDN images that need migration
    const images = await env.DB.prepare(`
        SELECT id, adopter_id, url 
        FROM adopter_images 
        WHERE (url LIKE '%scontent%' OR url LIKE '%fbcdn%' OR url LIKE '%fbsbx%' OR url LIKE '%lookaside%')
          AND url NOT LIKE '%r2.dev%'
        LIMIT ?
    `).bind(batchSize).all<{
        id: string;
        adopter_id: string;
        url: string;
    }>();

    const results: Array<{ id: string; status: string; r2Url?: string; error?: string }> = [];

    for (const img of images.results) {
        if (dryRun) {
            results.push({ id: img.id, status: 'dry_run', r2Url: `would-migrate: ${img.url.substring(0, 60)}...` });
            continue;
        }

        try {
            const r2Url = await persistImageToR2(img.url, img.adopter_id, img.id);

            if (r2Url) {
                // Update the DB row with the permanent R2 URL
                await env.DB.prepare(
                    `UPDATE adopter_images SET url = ? WHERE id = ?`
                ).bind(r2Url, img.id).run();

                results.push({ id: img.id, status: 'migrated', r2Url });
            } else {
                // Image couldn't be downloaded (expired) — mark as broken
                await env.DB.prepare(
                    `UPDATE adopter_images SET url = ?, caption = COALESCE(caption, '') || ' [broken: original expired]' WHERE id = ?`
                ).bind('broken:' + img.url, img.id).run();

                results.push({ id: img.id, status: 'broken', error: 'Could not download — URL likely expired' });
            }
        } catch (error) {
            results.push({ id: img.id, status: 'error', error: String(error) });
        }
    }

    const migrated = results.filter(r => r.status === 'migrated').length;
    const broken = results.filter(r => r.status === 'broken').length;
    const errors = results.filter(r => r.status === 'error').length;

    return NextResponse.json({
        processed: results.length,
        migrated,
        broken,
        errors,
        results,
        hasMore: images.results.length === batchSize
    });
}
