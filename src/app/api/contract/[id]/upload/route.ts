import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { withCors, corsPreflightResponse } from '@/lib/cors';

export const runtime = 'edge';

export async function OPTIONS(request: Request) {
    return corsPreflightResponse(request.headers.get('origin'));
}

/**
 * POST /api/contract/[id]/upload
 * 
 * Retry endpoint for uploading a contract PDF to R2.
 * Called when the initial submit succeeded (adoption created)
 * but the R2 upload failed.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id: animalId } = await params;
    const origin = request.headers.get('origin');

    try {
        const body = await request.json();
        const { screenshot } = body as { screenshot: string };

        if (!screenshot || !screenshot.startsWith('data:')) {
            return withCors(NextResponse.json({ error: 'No contract document provided' }, { status: 400 }), origin);
        }

        const match = screenshot.match(/^data:([^;]+);base64,([\s\S]+)$/);
        if (!match) {
            return withCors(NextResponse.json({ error: 'Invalid data URL format' }, { status: 400 }), origin);
        }

        const contentType = match[1];
        const base64Data = match[2].replace(/\s/g, '');
        const ext = contentType.includes('pdf') ? 'pdf' : contentType.includes('png') ? 'png' : 'jpg';

        const { uploadToR2 } = await import('@/lib/r2');
        // Convert base64 to a native ArrayBuffer via fetch (miniflare-compatible)
        const arrayBuffer = await fetch(`data:${contentType};base64,${base64Data}`).then(r => r.arrayBuffer());

        const key = `contracts/${animalId}/signed-contract.${ext}`;
        const contractUrl = await uploadToR2(key, arrayBuffer, contentType);
        logger.info('Contract document uploaded via retry', { animalId, key, sizeKB: Math.round(arrayBuffer.byteLength / 1024) });

        // Update the adoption record with the contract URL
        const { getDb } = await import('@/lib/db');
        const db = await getDb();
        if (db) {
            const { adoptions } = await import('@/db/schema');
            const { eq } = await import('drizzle-orm');
            await db.update(adoptions).set({
                comments: JSON.stringify({ contractScreenshot: contractUrl }),
            }).where(eq(adoptions.id, animalId));
        }

        return withCors(NextResponse.json({ success: true, contractUrl }), origin);
    } catch (error) {
        const errorId = logger.error('Contract upload retry failed', error);
        return withCors(NextResponse.json({ error: `Upload failed (Error ID: ${errorId})` }, { status: 500 }), origin);
    }
}
