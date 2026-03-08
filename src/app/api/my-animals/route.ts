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

    try {
        const { getDb } = await import('@/app/actions');
        const db = await getDb();
        if (!db) return NextResponse.json([], { status: 500 });

        const { adoptions, adopterImages, adopters } = await import('@/db/schema');
        const { eq, sql, and, isNull, isNotNull } = await import('drizzle-orm');

        const userEmail = session.user.email;
        if (!userEmail) {
            return NextResponse.json({ error: 'No email in session' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const view = searchParams.get('view') || 'available'; // 'available', 'adopted', or 'all'

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
            // Available animals (not yet adopted)
            results = await db.select().from(adoptions)
                .where(and(
                    eq(adoptions.addedBy, userEmail),
                    isNull(adoptions.adopterId),
                    eq(adoptions.recordType, 'available')
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

        // Enrich with images and adopter name
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

                return { ...animal, images, adopterName };
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
        logger.error('API my-animals error', error);
        return NextResponse.json([], { status: 500 });
    }
}
