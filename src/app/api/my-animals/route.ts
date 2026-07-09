import { NextResponse, NextRequest } from 'next/server';
import { auth } from '@/auth';
import { logger } from '@/lib/logger';
import { getFeatureFlag } from '@/config/features';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
    const session = await auth();

    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check feature flag
    const enabled = await getFeatureFlag('ENABLE_ANIMALS_FOR_ADOPTION');
    if (!enabled) {
        return NextResponse.json({ error: 'Feature disabled' }, { status: 403 });
    }

    const userEmail = session.user.email;
    if (!userEmail) {
        return NextResponse.json({ error: 'No email in session' }, { status: 401 });
    }
    const { searchParams } = new URL(request.url);
    const view = searchParams.get('view') || 'available'; // 'available', 'adopted', or 'all'

    try {
        const { getDb } = await import('@/app/actions');
        const db = await getDb();
        if (!db) {
            const errorId = logger.error('API my-animals: db unavailable', new Error('getDb returned null'), { userEmail, view });
            return NextResponse.json({ error: 'Database unavailable', errorId }, { status: 500 });
        }

        const { adoptions, adopterImages, adopters } = await import('@/db/schema');
        const { eq, sql, and, or, isNull, isNotNull } = await import('drizzle-orm');

        let results;
        if (view === 'adopted') {
            // Animals that have been adopted (recordType = 'adoption', linked to an adopter)
            results = await db.select().from(adoptions)
                .where(and(
                    eq(adoptions.addedBy, userEmail),
                    isNotNull(adoptions.adopterId),
                    eq(adoptions.recordType, 'adoption')
                ))
                .orderBy(sql`${adoptions.date} DESC`)
                .all();
        } else if (view === 'all') {
            // All animals by this user (for edit mode lookups)
            results = await db.select().from(adoptions)
                .where(eq(adoptions.addedBy, userEmail))
                .orderBy(sql`${adoptions.date} DESC`)
                .all();
        } else {
            // Available animals (not yet adopted) PLUS animals currently in a
            // foster home ("Tránsito"). Foster rows have an adopterId (the foster
            // home) + recordType='foster', so the isNull(adopterId) guard applies
            // only to plain 'available' rows — otherwise a fostered animal falls
            // through both /my-animals tabs and vanishes.
            results = await db.select().from(adoptions)
                .where(and(
                    eq(adoptions.addedBy, userEmail),
                    or(
                        and(isNull(adoptions.adopterId), eq(adoptions.recordType, 'available')),
                        eq(adoptions.recordType, 'foster')
                    )
                ))
                .orderBy(sql`${adoptions.date} DESC`)
                .all();
        }

        // Check for duplicates at query level
        const queryIds = results.map((r: any) => r.id);
        const queryDupes = queryIds.filter((id: string, i: number) => queryIds.indexOf(id) !== i);
        if (queryDupes.length > 0) {
            logger.warn('my-animals QUERY DUPLICATES', { view, dupes: queryDupes });
        }
        logger.info('my-animals query', { view, userEmail, resultCount: results.length, uniqueCount: new Set(queryIds).size });

        // v2.14.10-21: applicants for the per-animal disclosure on /my-animals.
        // Loaded once via getApplicantsForAnimal (D1-safe per-row enrichment).
        const { getApplicantsForAnimal } = await import('@/app/actions/applicants');

        // Enrich with images, adopter name, and (for available animals) the
        // list of people who applied via the customized form.
        const enriched = await Promise.all(
            results.map(async (animal: typeof adoptions.$inferSelect) => {
                const images = await db.select({
                    id: adopterImages.id,
                    url: adopterImages.url,
                    caption: adopterImages.caption
                })
                    .from(adopterImages)
                    .where(eq(adopterImages.adoptionId, animal.id))
                    .limit(5)
                    .all();

                let adopterName: string | null = null;
                if (animal.adopterId) {
                    const adopter = await db.select({ name: adopters.name })
                        .from(adopters)
                        .where(eq(adopters.id, animal.adopterId))
                        .get();
                    adopterName = adopter?.name || null;
                }

                // Only fetch applicants for "available" animals — the card
                // disclosure isn't useful once the animal has been adopted.
                const applicants = animal.adopterId ? [] : await getApplicantsForAnimal(animal.id);

                return { ...animal, images, adopterName, applicants };
            })
        );

        // Deduplicate server-side to guarantee unique IDs
        const seen = new Set<string>();
        const deduped = enriched.filter((a: any) => {
            if (seen.has(a.id)) return false;
            seen.add(a.id);
            return true;
        });

        return NextResponse.json(deduped);
    } catch (error) {
        const errorId = logger.error('API my-animals error', error, { userEmail, view });
        return NextResponse.json({ error: 'Failed to load animals', errorId }, { status: 500 });
    }
}
