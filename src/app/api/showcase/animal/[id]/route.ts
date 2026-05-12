export const runtime = 'edge';
import { NextResponse } from 'next/server';
import { withCors, corsPreflightResponse } from '@/lib/cors';
import { logger } from '@/lib/logger';
import { adoptions } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { availableAnimalsBase, buildPublicRescuer, fetchAnimalImages, pickPublicAnimal } from '@/lib/showcase';
import { getPublicConfig } from '@/lib/publicConfig';

/** GET /api/showcase/animal/[id] — single-animal detail page data.
 *  Used by the Vite /animal/[id] route: hero, gallery, badges, Adoptar CTA.
 *  Also returns the global Instagram URL so the page can link to the
 *  rescue community's social presence at the bottom of the detail page.
 *
 *  Strictly filters to recordType='available' AND adopterId IS NULL —
 *  if the animal has been adopted (status changed) the public detail
 *  returns 404 so stale URLs don't keep returning data forever.
 */
export async function OPTIONS(req: Request) {
    return corsPreflightResponse(req.headers.get('origin'));
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const origin = request.headers.get('origin');
    const { id } = await params;
    try {
        const db = await getDb();
        if (!db) return withCors(NextResponse.json({ error: 'Database unavailable' }, { status: 500 }), origin);

        const animalRow = await db.select()
            .from(adoptions)
            .where(and(eq(adoptions.id, id), availableAnimalsBase()))
            .get() as typeof adoptions.$inferSelect | undefined;
        if (!animalRow) {
            return withCors(NextResponse.json({ error: 'Animal not found' }, { status: 404 }), origin);
        }

        const imagesByAnimal = await fetchAnimalImages(db, [id]);
        const animalImages = imagesByAnimal.get(id) || [];

        // v2.14.10-12: photoless animals are excluded from the public catalog
        // — surface a 404 here too so a direct-link share to an uncataloged
        // animal doesn't leak data the list routes hide. Once the rescuer
        // adds an image, the page becomes reachable again.
        if (animalImages.length === 0) {
            return withCors(NextResponse.json({ error: 'Animal not found' }, { status: 404 }), origin);
        }

        const rescuer = await buildPublicRescuer(db, animalRow.addedBy);
        const animal = pickPublicAnimal(animalRow, animalImages, rescuer);

        // Pull global INSTAGRAM_URL so the detail page can show the social CTA
        // when the empty-state isn't relevant (i.e. this single-animal page).
        // Fail-soft: if config read errors, just omit the field.
        let instagramUrl = '';
        try {
            const config = await getPublicConfig();
            instagramUrl = config.INSTAGRAM_URL || '';
        } catch { /* swallow */ }

        return withCors(NextResponse.json({
            animal,
            instagramUrl: instagramUrl || undefined,
        }, { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=600' } }), origin);
    } catch (e) {
        const errorId = logger.error('GET /api/showcase/animal/[id] failed', e, { id });
        return withCors(NextResponse.json({ error: 'Failed to load animal', errorId }, { status: 500 }), origin);
    }
}
