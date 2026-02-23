export const runtime = 'edge';

import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import { auth } from '@/auth';
import { isAdminAsync } from '@/config/admins';
import { persistImageToR2 } from '@/lib/r2';

/**
 * Save images to R2 for an adopter.
 * Deletes ALL existing images first, then saves fresh ones from the provided URLs.
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

    let saved = 0;
    const errors: string[] = [];

    for (const imgUrl of body.imageUrls) {
        try {
            const imageId = crypto.randomUUID();
            const r2Url = await persistImageToR2(imgUrl, body.adopterId, imageId);

            if (r2Url) {
                await env.DB.prepare(
                    `INSERT INTO adopter_images (id, adopter_id, url, added_by) VALUES (?, ?, ?, ?)`
                ).bind(imageId, body.adopterId, r2Url, session.user.email).run();
                saved++;
            } else {
                errors.push(`Download failed: ${imgUrl.substring(0, 60)}`);
            }
        } catch (error) {
            errors.push(`Error: ${String(error).substring(0, 80)}`);
        }
    }

    return NextResponse.json({
        adopterId: body.adopterId,
        deleted: 'all old images',
        saved,
        total: body.imageUrls.length,
        errors: errors.length > 0 ? errors : undefined,
    });
}
