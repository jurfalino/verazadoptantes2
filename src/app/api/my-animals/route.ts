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

        // Edit mode fetches ONE animal by id. Without this, the edit page pulled
        // the whole `view=all` list and enriched every row (2–3 D1 queries each) —
        // for a large rescuer (1000+ records) that's thousands of subrequests in
        // one request → past Cloudflare's Workers subrequest limit → 500.
        const idParam = searchParams.get('id');

        let results;
        if (idParam) {
            results = await db.select().from(adoptions)
                .where(and(eq(adoptions.addedBy, userEmail), eq(adoptions.id, idParam)))
                .all();
        } else if (view === 'adopted') {
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

        // v2.55.16: «N pendientes» badge — due follow-ups per placed animal, so
        // the list works as the follow-through triage board. Flag-gated; the
        // owner's schedule is loaded ONCE; per-row computation fails open.
        let followupCtx: null | {
            schedule: import('@/domain/followups').ScheduleEntry[];
            fosterRule: import('@/domain/followups').FosterRule;
            compute: typeof import('@/domain/followups').computeFollowups;
        } = null;
        const followupsOn = await getFeatureFlag('ENABLE_FOLLOWUPS').catch(() => false);
        if (followupsOn && !idParam) {
            try {
                const { computeFollowups, mergeSchedule, mergeFosterRule, parseFollowupSettings, DEFAULT_SCHEDULE } = await import('@/domain/followups');
                const { users, userProfiles } = await import('@/db/schema');
                const row = await db.select({ settings: userProfiles.followupSettings })
                    .from(userProfiles)
                    .innerJoin(users, eq(users.id, userProfiles.userId))
                    .where(eq(users.email, userEmail)).get();
                const settings = parseFollowupSettings(row?.settings);
                followupCtx = { schedule: mergeSchedule(DEFAULT_SCHEDULE, settings), fosterRule: mergeFosterRule(settings), compute: computeFollowups };
            } catch (e) {
                logger.warn('my-animals: followup settings fallback', { userEmail, view, error: e instanceof Error ? e.message : String(e) });
            }
        }

        // Enrich with images, adopter name, and (for available animals) the
        // list of people who applied via the customized form.
        const enriched = await Promise.all(
            results.map(async (animal: typeof adoptions.$inferSelect) => {
                // Each per-row sub-query fails OPEN (degrade this row, log a warn)
                // so one transient D1 hiccup can't reject the whole Promise.all and
                // 500 the entire route (CLAUDE.md D1-fallback convention).
                const images = await db.select({
                    id: adopterImages.id,
                    url: adopterImages.url,
                    caption: adopterImages.caption
                })
                    .from(adopterImages)
                    .where(eq(adopterImages.adoptionId, animal.id))
                    .limit(5)
                    .all()
                    .catch((e: unknown) => {
                        logger.warn('my-animals: images fallback', { animalId: animal.id, userEmail, view, error: e instanceof Error ? e.message : String(e) });
                        return [] as { id: string; url: string; caption: string | null }[];
                    });

                let adopterName: string | null = null;
                if (animal.adopterId) {
                    const adopter = await db.select({ name: adopters.name })
                        .from(adopters)
                        .where(eq(adopters.id, animal.adopterId))
                        .get()
                        .catch((e: unknown) => {
                            logger.warn('my-animals: adopter-name fallback', { animalId: animal.id, adopterId: animal.adopterId, userEmail, view, error: e instanceof Error ? e.message : String(e) });
                            return undefined;
                        });
                    adopterName = adopter?.name || null;
                }

                // Only fetch applicants for "available" animals — the card
                // disclosure isn't useful once the animal has been adopted.
                const applicants = animal.adopterId ? [] : await getApplicantsForAnimal(animal.id).catch((e: unknown) => {
                    logger.warn('my-animals: applicants fallback', { animalId: animal.id, userEmail, view, error: e instanceof Error ? e.message : String(e) });
                    return [];
                });

                // Due follow-up count for the badge — only animals with an
                // active placement (the view row's adopterId marks it).
                let dueFollowups = 0;
                if (followupCtx && animal.adopterId && animal.date) {
                    try {
                        const { placements, adopterEvents, animalEvents, animals } = await import('@/db/schema');
                        const { isNull: isNullOp } = await import('drizzle-orm');
                        const [activeRows, evRows, careRows, animalRow] = await Promise.all([
                            db.select({ id: placements.id, startedAt: placements.startedAt, recordType: placements.recordType })
                                .from(placements)
                                .where(and(eq(placements.animalId, animal.id), isNullOp(placements.endedAt))).all(),
                            db.select({ id: adopterEvents.id, date: adopterEvents.date, followupKey: adopterEvents.followupKey, followupSubtype: adopterEvents.followupSubtype, eventType: adopterEvents.eventType, placementId: adopterEvents.placementId })
                                .from(adopterEvents).where(eq(adopterEvents.animalId, animal.id)).all(),
                            db.select({ id: animalEvents.id, date: animalEvents.date, followupKey: animalEvents.followupKey, eventType: animalEvents.eventType })
                                .from(animalEvents).where(eq(animalEvents.animalId, animal.id)).all(),
                            db.select({ estimatedBirthDate: animals.estimatedBirthDate, neutered: animals.neutered })
                                .from(animals).where(eq(animals.id, animal.id)).get(),
                        ]);
                        const active = activeRows[0];
                        if (active?.startedAt) {
                            const asDate = (v: unknown): Date | null => v instanceof Date ? v : typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : null;
                            const slots = followupCtx.compute({
                                placementStartedAt: asDate(active.startedAt)!,
                                placementType: active.recordType,
                                animal: { estimatedBirthDate: asDate(animalRow?.estimatedBirthDate ?? null), neutered: animalRow?.neutered ?? null },
                                schedule: followupCtx.schedule,
                                fosterRule: followupCtx.fosterRule,
                                recorded: [
                                    ...evRows.filter((e: { placementId: string | null }) => e.placementId === active.id || !e.placementId)
                                        .map((e: { id: string; date: unknown; followupKey: string | null; followupSubtype: string | null; eventType: string }) =>
                                            ({ id: e.id, date: asDate(e.date), followupKey: e.followupKey, subtype: e.followupSubtype, eventType: e.eventType })),
                                    ...careRows.map((e: { id: string; date: unknown; followupKey: string | null; eventType: string }) =>
                                        ({ id: e.id, date: asDate(e.date), followupKey: e.followupKey, subtype: null, eventType: e.eventType })),
                                ],
                                now: new Date(),
                            });
                            dueFollowups = slots.filter(s => s.status === 'due').length;
                        }
                    } catch (e) {
                        logger.warn('my-animals: due-followups fallback', { animalId: animal.id, userEmail, view, error: e instanceof Error ? e.message : String(e) });
                    }
                }

                return { ...animal, images, adopterName, applicants, dueFollowups };
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
