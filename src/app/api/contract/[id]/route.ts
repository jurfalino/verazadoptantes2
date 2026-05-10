import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { withCors, corsPreflightResponse } from '@/lib/cors';

export const runtime = 'edge';

export async function OPTIONS(request: Request) {
    return corsPreflightResponse(request.headers.get('origin'));
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const origin = request.headers.get('origin');

    try {
        const { getDb } = await import('@/lib/db');
        const db = await getDb();
        if (!db) return withCors(NextResponse.json({ error: 'Database unavailable' }, { status: 500 }), origin);

        const { adoptions, adopterImages, users } = await import('@/db/schema');
        const { eq } = await import('drizzle-orm');

        const animal = await db.select().from(adoptions).where(eq(adoptions.id, id)).get();

        if (!animal) {
            return withCors(NextResponse.json({ error: 'Not found' }, { status: 404 }), origin);
        }

        // Fetch animal images
        const images = await db.select({
            id: adopterImages.id,
            url: adopterImages.url,
            caption: adopterImages.caption
        }).from(adopterImages)
            .where(eq(adopterImages.adoptionId, id))
            .limit(5)
            .all();

        // Resolve rescuer display name from the `user` table (the name they picked in /settings).
        // Falls back to the email's local-part only if no name is set or the lookup fails.
        let rescuerDisplay: string | null = null;
        if (animal.addedBy) {
            try {
                const userRow = await db.select({ name: users.name })
                    .from(users)
                    .where(eq(users.email, animal.addedBy))
                    .get();
                const name = userRow?.name?.trim();
                rescuerDisplay = name || animal.addedBy.split('@')[0];
            } catch (e) {
                logger.warn('Contract data: rescuerName lookup failed', {
                    animalId: id,
                    addedBy: animal.addedBy,
                    error: e instanceof Error ? e.message : String(e),
                });
                rescuerDisplay = animal.addedBy.split('@')[0];
            }
        }

        // Return only safe public fields (no PII)
        return withCors(NextResponse.json({
            id: animal.id,
            animalName: animal.animalName,
            species: animal.species,
            details: animal.details,
            comments: animal.comments,
            age: animal.age,
            estimatedBirthDate: animal.estimatedBirthDate,
            neutered: animal.neutered,
            sex: animal.sex,
            color: animal.color,
            microchip: animal.microchip,
            rescuerName: rescuerDisplay,
            images,
        }), origin);
    } catch (error) {
        logger.error('Contract data fetch failed', error);
        return withCors(NextResponse.json({ error: 'Internal error' }, { status: 500 }), origin);
    }
}
