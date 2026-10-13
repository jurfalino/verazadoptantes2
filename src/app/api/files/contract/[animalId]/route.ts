// A signed contract, from private storage (src/lib/contractStorage.ts). Only the
// animal's rescue — its owner, or someone in a directly shared organization —
// and admins. Anyone else, and any animal without a contract, gets the same 404.
import { NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { auth } from '@/auth';
import { isAdminAsync } from '@/config/admins';
import { animals, placements } from '@/db/schema';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { contractKeyOf, readContract } from '@/lib/contractStorage';
import { loadOrgMembership, sameRescueDirect } from '@/lib/rescueKeys';

export const runtime = 'edge';

const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'cache-control': 'no-store' } });

export async function GET(request: Request, { params }: { params: Promise<{ animalId: string }> }) {
    const { animalId } = await params;
    const placementId = new URL(request.url).searchParams.get('placement');
    const email = (await auth())?.user?.email ?? null;
    if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    try {
        const db = await getDb();
        if (!db) throw new Error('database unavailable');
        const animal = await db.select({ addedBy: animals.addedBy }).from(animals).where(eq(animals.id, animalId)).get();
        if (!animal) return notFound();
        const allowed = (await isAdminAsync(email)) || sameRescueDirect(email, animal.addedBy, await loadOrgMembership(db, 'contractFile'));
        if (!allowed) {
            logger.info('contract file: refused', { animalId, viewer: email });
            return notFound();
        }
        // A named placement (the animal timeline's past adoptions) must belong to this animal.
        const placement = await db.select({ comments: placements.comments }).from(placements)
            .where(placementId
                ? and(eq(placements.id, placementId), eq(placements.animalId, animalId))
                : and(eq(placements.animalId, animalId), isNull(placements.endedAt))).get();
        const key = contractKeyOf(placement?.comments);
        if (!key) return notFound();
        const file = await readContract(key);
        if (!file) {
            logger.warn('contract file: key on record but no file in storage', { animalId, key });
            return notFound();
        }
        logger.info('contract file: served', { animalId, viewer: email });
        return new Response(file.body, {
            headers: {
                'content-type': file.httpMetadata?.contentType ?? 'application/pdf',
                'content-disposition': 'inline',
                'cache-control': 'private, no-store',
                'x-content-type-options': 'nosniff',
            },
        });
    } catch (e) {
        const errorId = logger.error('contract file: failed', e, { animalId, viewer: email });
        return NextResponse.json({ error: `No se pudo abrir el contrato (ID: ${errorId})` }, { status: 500 });
    }
}
