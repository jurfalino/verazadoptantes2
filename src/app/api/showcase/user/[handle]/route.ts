export const runtime = 'edge';
import { NextResponse } from 'next/server';
import { withCors, corsPreflightResponse } from '@/lib/cors';
import { logger } from '@/lib/logger';
import { adoptions, userProfiles, users } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { availableAnimalsBase, availableAnimalsOrder, buildPublicRescuer, fetchAnimalImages, pickPublicAnimal } from '@/lib/showcase';

/** GET /api/showcase/user/[handle] — public list of a single rescuer's available animals.
 *  Handle → user_profiles.user_id → user.email → adoptions.addedBy.
 *  Returns the rescuer's display info + their animals.
 */
export async function OPTIONS(req: Request) {
    return corsPreflightResponse(req.headers.get('origin'));
}

export async function GET(request: Request, { params }: { params: Promise<{ handle: string }> }) {
    const origin = request.headers.get('origin');
    const { handle } = await params;
    try {
        const db = await getDb();
        if (!db) return withCors(NextResponse.json({ error: 'Database unavailable' }, { status: 500 }), origin);

        const profile = await db.select({ userId: userProfiles.userId, handle: userProfiles.handle })
            .from(userProfiles)
            .where(eq(userProfiles.handle, handle))
            .get();
        if (!profile) {
            return withCors(NextResponse.json({ error: 'User not found' }, { status: 404 }), origin);
        }

        const user = await db.select({ email: users.email, name: users.name })
            .from(users)
            .where(eq(users.id, profile.userId))
            .get();
        if (!user?.email) {
            return withCors(NextResponse.json({ error: 'User not found' }, { status: 404 }), origin);
        }

        const rows = await db.select()
            .from(adoptions)
            .where(and(availableAnimalsBase(), eq(adoptions.addedBy, user.email)))
            .orderBy(availableAnimalsOrder())
            .limit(60)
            .all() as (typeof adoptions.$inferSelect)[];

        const ids = rows.map((r) => r.id);
        const imagesByAnimal = await fetchAnimalImages(db, ids);
        const rescuer = await buildPublicRescuer(db, user.email);

        // v2.14.10-12: skip photoless animals (rule mirrored across all
        // showcase list routes; rescuers see the hidden-when-photoless
        // notice in the /my-animals share modal).
        const animals = rows
            .map((row) => ({ row, images: imagesByAnimal.get(row.id) || [] }))
            .filter(({ images }) => images.length > 0)
            .map(({ row, images }) => pickPublicAnimal(row, images, rescuer));

        return withCors(NextResponse.json({
            rescuer,
            animals,
        }, { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=600' } }), origin);
    } catch (e) {
        const errorId = logger.error('GET /api/showcase/user/[handle] failed', e, { handle });
        return withCors(NextResponse.json({ error: 'Failed to load user animals', errorId }, { status: 500 }), origin);
    }
}
