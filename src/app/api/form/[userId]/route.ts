import { NextResponse } from 'next/server';
import { withCors, corsPreflightResponse } from '@/lib/cors';
import { logger } from '@/lib/logger';

export const runtime = 'edge';

export async function OPTIONS(request: Request) {
    return corsPreflightResponse(request.headers.get('origin'));
}

/**
 * GET /api/form/{userId}
 * Quick validation check — contract-app calls this to confirm the userId is valid
 * before showing the form.
 */
export async function GET(request: Request, { params }: { params: Promise<{ userId: string }> }) {
    const { userId } = await params;
    const origin = request.headers.get('origin');

    try {
        const { getDb } = await import('@/lib/db');
        const db = await getDb();
        if (!db) {
            const errorId = logger.error('api/form/[userId]: db unavailable', new Error('getDb returned null'), { userId });
            return withCors(NextResponse.json({ valid: false, errorId }, { status: 500 }), origin);
        }

        const { users } = await import('@/db/schema');
        const { eq } = await import('drizzle-orm');

        const user = await db
            .select({ name: users.name, email: users.email })
            .from(users)
            .where(eq(users.id, userId))
            .get();

        // Custom forms (spec 2026-10-14 §6.2): null ONLY when the switch is off —
        // the public form's "today's form". On, but nothing customised yet → the
        // defaults ({ hiddenSteps: [] }), which include the new questions.
        // (Applied here, not in resolveDocsForRescuer: the contract routes and
        // the submit route also read it, and must keep "null = standard".)
        const { resolveDocsForRescuer } = await import('@/lib/adoptionDocsRepo');
        const { getFeatureFlag } = await import('@/config/features');
        const resolved = await resolveDocsForRescuer(db, user?.email);
        const formConfig = resolved
            ? { hiddenSteps: resolved.hiddenSteps }
            : (await getFeatureFlag('ENABLE_CUSTOM_ADOPTION_DOCS')) ? { hiddenSteps: [] as string[] } : null;

        // Cat-only / dog-only questions on a form opened for one animal (the
        // species question is skipped there). Same lookup as the submit route;
        // only the species leaves this route.
        const animalId = new URL(request.url).searchParams.get('animalId');
        let animalSpecies: 'cat' | 'dog' | null = null;
        if (animalId) {
            const { adoptions } = await import('@/db/schema');
            const row = await db.select({ species: adoptions.species }).from(adoptions).where(eq(adoptions.id, animalId)).get()
                .catch((e: unknown) => {
                    logger.warn('api/form/[userId]: animal species lookup failed', { userId, animalId, error: e instanceof Error ? e.message : String(e) });
                    return undefined;
                });
            const sp = row?.species?.trim().toLowerCase();
            animalSpecies = sp === 'cat' || sp === 'gato' ? 'cat' : sp === 'dog' || sp === 'perro' ? 'dog' : null;
        }

        return withCors(NextResponse.json({
            valid: !!user,
            userName: user?.name || null,
            formConfig,
            animalSpecies,
        }), origin);
    } catch (e) {
        const errorId = logger.error('api/form/[userId] failed', e, { userId });
        return withCors(NextResponse.json({ valid: false, errorId }, { status: 500 }), origin);
    }
}
