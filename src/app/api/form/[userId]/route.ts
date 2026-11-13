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

        // A form opened for one animal (`?animalId=`): its species picks the
        // cat-only / dog-only questions (the species question is skipped there),
        // and the form names it at the top (Jon 2026-11-13) — only an animal of
        // the link owner's team that still takes applications, its photo only
        // while it is in the public catalogue (formAnimalForLink).
        const animalId = new URL(request.url).searchParams.get('animalId');
        let animalSpecies: 'cat' | 'dog' | null = null;
        let animal: { name: string; photo: string | null } | null = null;
        if (animalId) {
            const { adoptions } = await import('@/db/schema');
            const row = await db.select({ species: adoptions.species, name: adoptions.animalName, addedBy: adoptions.addedBy, recordType: adoptions.recordType, adopterId: adoptions.adopterId, listed: adoptions.listed })
                .from(adoptions).where(eq(adoptions.id, animalId)).get()
                .catch((e: unknown) => {
                    logger.warn('api/form/[userId]: animal lookup failed', { userId, animalId, error: e instanceof Error ? e.message : String(e) });
                    return undefined;
                });
            const sp = row?.species?.trim().toLowerCase();
            animalSpecies = sp === 'cat' || sp === 'gato' ? 'cat' : sp === 'dog' || sp === 'perro' ? 'dog' : null;
            if (row && user?.email) {
                try {
                    const [{ getTeamEmails }, { formAnimalForLink }] = await Promise.all([
                        import('@/lib/orgMembership'),
                        import('@/domain/shareFormAnimals'),
                    ]);
                    const shown = formAnimalForLink(row, await getTeamEmails(user.email));
                    if (shown) {
                        let photo: string | null = null;
                        if (shown.publicPhoto) {
                            const { fetchAnimalImages } = await import('@/lib/showcase');
                            const first = (await fetchAnimalImages(db, [animalId])).get(animalId)?.[0];
                            photo = first ? (first.mediaType === 'video' ? first.thumbnailUrl ?? null : first.url) : null;
                        }
                        animal = { name: shown.name, photo };
                    }
                } catch (e) {
                    // The form still opens, just without the animal at the top.
                    logger.warn('api/form/[userId]: animal header falls back to the generic form', { userId, animalId, error: e instanceof Error ? e.message : String(e) });
                }
            }
        }

        return withCors(NextResponse.json({
            valid: !!user,
            userName: user?.name || null,
            formConfig,
            animalSpecies,
            animal,
        }), origin);
    } catch (e) {
        const errorId = logger.error('api/form/[userId] failed', e, { userId });
        return withCors(NextResponse.json({ valid: false, errorId }, { status: 500 }), origin);
    }
}
