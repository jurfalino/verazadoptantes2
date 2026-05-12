export const runtime = 'edge';
import { NextResponse } from 'next/server';
import { withCors, corsPreflightResponse } from '@/lib/cors';
import { logger } from '@/lib/logger';
import { adoptions } from '@/db/schema';
import { getDb } from '@/lib/db';
import { availableAnimalsBase, availableAnimalsOrder, buildPublicRescuer, fetchAnimalImages, pickPublicAnimal, type PublicAnimal } from '@/lib/showcase';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 60;

/**
 * Public catalog of all available animals across the platform (v2.14.10-1).
 * Anonymous-readable. Whitelist-only fields via `pickPublicAnimal`.
 * Paginated by offset (cursor would be nicer but offset is enough at this scale).
 */
export async function OPTIONS(req: Request) {
    return corsPreflightResponse(req.headers.get('origin'));
}

export async function GET(request: Request) {
    const origin = request.headers.get('origin');
    try {
        const url = new URL(request.url);
        const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(url.searchParams.get('limit') || `${DEFAULT_LIMIT}`, 10) || DEFAULT_LIMIT));
        const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);

        const db = await getDb();
        if (!db) return withCors(NextResponse.json({ animals: [], total: 0 }), origin);

        const rows = await db.select()
            .from(adoptions)
            .where(availableAnimalsBase())
            .orderBy(availableAnimalsOrder())
            .limit(limit)
            .offset(offset)
            .all() as (typeof adoptions.$inferSelect)[];

        const ids = rows.map((r) => r.id);
        const imagesByAnimal = await fetchAnimalImages(db, ids);

        // Resolve rescuer per row. Dedup by `addedBy` so we don't run the
        // same lookup N times for animals from the same rescuer.
        //
        // v2.14.10-12: skip animals with no public photo. A photoless card in
        // the catalog reads as broken/abandoned to a first-time visitor and
        // hurts both the rescuer's listing and overall trust in the surface.
        // Rescuers see the hidden-when-photoless rule called out in the
        // /my-animals share-public-catalog modal.
        const rescuerCache = new Map<string, ReturnType<typeof buildPublicRescuer>>();
        const animals: PublicAnimal[] = [];
        for (const row of rows) {
            const animalImages = imagesByAnimal.get(row.id) || [];
            if (animalImages.length === 0) continue;
            const key = row.addedBy || '';
            if (!rescuerCache.has(key)) {
                rescuerCache.set(key, buildPublicRescuer(db, row.addedBy));
            }
            const rescuer = await rescuerCache.get(key)!;
            animals.push(pickPublicAnimal(row, animalImages, rescuer));
        }

        return withCors(
            NextResponse.json(
                { animals, total: animals.length, limit, offset },
                { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=600' } },
            ),
            origin,
        );
    } catch (e) {
        const errorId = logger.error('GET /api/showcase/all failed', e);
        return withCors(NextResponse.json({ error: 'Failed to load animals', errorId }, { status: 500 }), origin);
    }
}
