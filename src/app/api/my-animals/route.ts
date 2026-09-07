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

        // v2.55.18: animals are TEAM resources — the list spans the org (self +
        // org-mates). OR fan-out per email, never `IN ${array}` (D1 quirk).
        // Fails open to [self] inside getTeamEmails.
        const { getTeamEmails } = await import('@/lib/orgMembership');
        const teamEmails = await getTeamEmails(userEmail);
        // Fail CLOSED: `or()` of an empty array is `undefined`, and `and(undefined, …)`
        // silently drops it — an empty team list would return EVERY animal to any
        // authenticated user. getTeamEmails always includes self today, so this is
        // defense in depth against a future refactor, not a live hole.
        const scopeEmails = teamEmails.length > 0 ? teamEmails : [userEmail];
        const teamMatch = or(...scopeEmails.map((e: string) => eq(adoptions.addedBy, e)));

        let results;
        if (idParam) {
            results = await db.select().from(adoptions)
                .where(and(teamMatch, eq(adoptions.id, idParam)))
                .all();
        } else if (view === 'adopted') {
            // Animals that have been adopted (recordType = 'adoption', linked to an adopter)
            results = await db.select().from(adoptions)
                .where(and(
                    teamMatch,
                    isNotNull(adoptions.adopterId),
                    eq(adoptions.recordType, 'adoption')
                ))
                .orderBy(sql`${adoptions.date} DESC`)
                .all();
        } else if (view === 'all') {
            // All animals by this user's team (for edit mode lookups)
            results = await db.select().from(adoptions)
                .where(teamMatch)
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
                    teamMatch,
                    or(
                        and(isNull(adoptions.adopterId), eq(adoptions.recordType, 'available')),
                        eq(adoptions.recordType, 'foster')
                    )
                ))
                .orderBy(sql`${adoptions.date} DESC`)
                .all();
        }

        // Attribution for the "de {name}" marker on teammates' cards.
        let teamNameMap: Record<string, string> = {};
        try {
            const { resolveUserNames } = await import('@/app/actions/userNames');
            teamNameMap = await resolveUserNames(Array.from(new Set(results.map((r: any) => r.addedBy).filter(Boolean))));
        } catch (e) {
            logger.warn('my-animals: name resolution fallback', { userEmail, view, error: e instanceof Error ? e.message : String(e) });
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
        /* v2.55.20 bulk read, HOISTED out of the follow-up flag in v2.56.16.
         * 4 queries TOTAL, independent of N — the per-row fan-out (4 × N) once
         * pushed large rescuers toward the Workers subrequest limit this route
         * has hit historically. Two features consume it now: the «N pendientes»
         * badge and «Actualizado por», and the latter must not depend on a flag.
         * Skipped for ?id= (a single-animal fetch wants one row, not the set). */
        type ActiveRow = { id: string; animalId: string; startedAt: unknown; endedAt: unknown; recordType: string; recordedBy: string | null; createdAt: unknown };
        type EvRow = { id: string; animalId: string | null; date: unknown; followupKey: string | null; followupSubtype: string | null; eventType: string; placementId: string | null; recordedBy: string | null; createdAt: unknown };
        type CareRow = { id: string; animalId: string; date: unknown; followupKey: string | null; eventType: string; recordedBy: string | null; createdAt: unknown };
        type AnimalRow = { id: string; estimatedBirthDate: unknown; neutered: number | null; updatedAt: unknown; updatedBy: string | null };

        let bulk: null | {
            activeByAnimal: Map<string, ActiveRow>;
            placementsByAnimal: Map<string, ActiveRow[]>;
            eventsByAnimal: Map<string, EvRow[]>;
            careByAnimal: Map<string, CareRow[]>;
            animalById: Map<string, AnimalRow>;
        } = null;

        if (!idParam) {
            try {
                const { placements, adopterEvents, animalEvents, animals } = await import('@/db/schema');
                const ownerMatch = or(...scopeEmails.map((e: string) => eq(animals.addedBy, e)));
                const [placementRows, evRows, careRows, animalRows] = await Promise.all([
                    // NOT filtered to active: an ENDED span (a devolución) is an
                    // update too, and `active` is derived from endedAt in JS.
                    db.select({ id: placements.id, animalId: placements.animalId, startedAt: placements.startedAt, endedAt: placements.endedAt, recordType: placements.recordType, recordedBy: placements.recordedBy, createdAt: placements.createdAt })
                        .from(placements).innerJoin(animals, eq(animals.id, placements.animalId))
                        .where(ownerMatch).all(),
                    db.select({ id: adopterEvents.id, animalId: adopterEvents.animalId, date: adopterEvents.date, followupKey: adopterEvents.followupKey, followupSubtype: adopterEvents.followupSubtype, eventType: adopterEvents.eventType, placementId: adopterEvents.placementId, recordedBy: adopterEvents.recordedBy, createdAt: adopterEvents.createdAt })
                        .from(adopterEvents).innerJoin(animals, eq(animals.id, adopterEvents.animalId))
                        .where(ownerMatch).all(),
                    db.select({ id: animalEvents.id, animalId: animalEvents.animalId, date: animalEvents.date, followupKey: animalEvents.followupKey, eventType: animalEvents.eventType, recordedBy: animalEvents.recordedBy, createdAt: animalEvents.createdAt })
                        .from(animalEvents).innerJoin(animals, eq(animals.id, animalEvents.animalId))
                        .where(ownerMatch).all(),
                    db.select({ id: animals.id, estimatedBirthDate: animals.estimatedBirthDate, neutered: animals.neutered, updatedAt: animals.updatedAt, updatedBy: animals.updatedBy })
                        .from(animals).where(ownerMatch).all(),
                ]);

                const placementsByAnimal = new Map<string, ActiveRow[]>();
                const activeByAnimal = new Map<string, ActiveRow>();
                for (const r of placementRows as ActiveRow[]) {
                    const list = placementsByAnimal.get(r.animalId) || []; list.push(r); placementsByAnimal.set(r.animalId, list);
                    if (r.endedAt == null) activeByAnimal.set(r.animalId, r);
                }
                const eventsByAnimal = new Map<string, EvRow[]>();
                for (const r of evRows as EvRow[]) {
                    if (!r.animalId) continue;
                    const list = eventsByAnimal.get(r.animalId) || []; list.push(r); eventsByAnimal.set(r.animalId, list);
                }
                const careByAnimal = new Map<string, CareRow[]>();
                for (const r of careRows as CareRow[]) {
                    const list = careByAnimal.get(r.animalId) || []; list.push(r); careByAnimal.set(r.animalId, list);
                }
                const animalById = new Map<string, AnimalRow>();
                for (const r of animalRows as AnimalRow[]) animalById.set(r.id, r);

                bulk = { activeByAnimal, placementsByAnimal, eventsByAnimal, careByAnimal, animalById };
            } catch (e) {
                logger.warn('my-animals: bulk activity fallback', { userEmail, view, error: e instanceof Error ? e.message : String(e) });
            }
        }

        // v2.55.16: «N pendientes» badge — due follow-ups per placed animal, so
        // the list works as the follow-through triage board. Flag-gated; the
        // owner's schedule is loaded ONCE; per-row computation fails open.
        let followupCtx: null | {
            schedule: import('@/domain/followups').ScheduleEntry[];
            fosterRule: import('@/domain/followups').FosterRule;
            compute: typeof import('@/domain/followups').computeFollowups;
        } = null;
        const followupsOn = await getFeatureFlag('ENABLE_FOLLOWUPS').catch(() => false);
        if (followupsOn && bulk) {
            try {
                const { computeFollowups, mergeSchedule, mergeFosterRule, parseFollowupSettings, DEFAULT_SCHEDULE } = await import('@/domain/followups');
                const { users, userProfiles } = await import('@/db/schema');
                const row = await db.select({ settings: userProfiles.followupSettings })
                    .from(userProfiles)
                    .innerJoin(users, eq(users.id, userProfiles.userId))
                    .where(eq(users.email, userEmail)).get();
                const settings = parseFollowupSettings(row?.settings);
                followupCtx = {
                    schedule: mergeSchedule(DEFAULT_SCHEDULE, settings),
                    fosterRule: mergeFosterRule(settings),
                    compute: computeFollowups,
                };
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
                if (followupCtx && bulk && animal.adopterId && animal.date) {
                    try {
                        // v2.55.20: pure map lookups — zero extra subrequests per row.
                        const active = bulk!.activeByAnimal.get(animal.id);
                        if (active?.startedAt) {
                            const asDate = (v: unknown): Date | null => v instanceof Date ? v : typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : null;
                            const evRows = bulk!.eventsByAnimal.get(animal.id) || [];
                            const careRows = bulk!.careByAnimal.get(animal.id) || [];
                            const animalRow = bulk!.animalById.get(animal.id);
                            const slots = followupCtx.compute({
                                placementStartedAt: asDate(active.startedAt)!,
                                placementType: active.recordType,
                                animal: { estimatedBirthDate: asDate(animalRow?.estimatedBirthDate ?? null), neutered: animalRow?.neutered ?? null },
                                schedule: followupCtx.schedule,
                                fosterRule: followupCtx.fosterRule,
                                recorded: [
                                    ...evRows.filter(e => e.placementId === active.id || !e.placementId)
                                        .map(e => ({ id: e.id, date: asDate(e.date), followupKey: e.followupKey, subtype: e.followupSubtype, eventType: e.eventType })),
                                    ...careRows.map(e => ({ id: e.id, date: asDate(e.date), followupKey: e.followupKey, subtype: null, eventType: e.eventType })),
                                ],
                                now: new Date(),
                            });
                            dueFollowups = slots.filter(s => s.status === 'due').length;
                        }
                    } catch (e) {
                        logger.warn('my-animals: due-followups fallback', { animalId: animal.id, userEmail, view, error: e instanceof Error ? e.message : String(e) });
                    }
                }

                /* v2.56.16: who last touched this animal, and when. Derived
                 * rather than stamped — placements/adopter_events/animal_events
                 * all carry `recorded_by`, so nothing has to remember to keep a
                 * column fresh. `animals.updated_by` covers the one case those
                 * tables cannot see: a pure ficha edit.
                 *
                 * created_at, NOT date/started_at: those are real-world dates
                 * the rescuer types and can backdate by months, and "actualizado"
                 * means app-time. 'anonymous' is the tables' DEFAULT, so it is
                 * not an actor — skip it and fall back to the registration. */
                const toMs = (v: unknown): number | null =>
                    v instanceof Date ? v.getTime() : typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : null;
                const named = (by: string | null | undefined): by is string => !!by && by !== 'anonymous';
                let lastUpdate: { by: string; at: number; kind: 'updated' | 'added' } | null = null;
                if (bulk) {
                    const consider = (by: string | null | undefined, at: unknown) => {
                        const ms = toMs(at);
                        if (!named(by) || ms == null) return;
                        if (!lastUpdate || ms > lastUpdate.at) lastUpdate = { by, at: ms, kind: 'updated' };
                    };
                    const arow = bulk.animalById.get(animal.id);
                    consider(arow?.updatedBy, arow?.updatedAt);
                    for (const p of bulk.placementsByAnimal.get(animal.id) || []) consider(p.recordedBy, p.createdAt);
                    for (const e of bulk.eventsByAnimal.get(animal.id) || []) consider(e.recordedBy, e.createdAt);
                    for (const c of bulk.careByAnimal.get(animal.id) || []) consider(c.recordedBy, c.createdAt);
                }
                // Never touched since it was created — say so honestly rather
                // than calling a registration an update.
                if (!lastUpdate && named(animal.addedBy) && toMs(animal.date) != null) {
                    lastUpdate = { by: animal.addedBy as string, at: toMs(animal.date)!, kind: 'added' };
                }

                return {
                    ...animal, images, adopterName, applicants, dueFollowups,
                    // v2.55.18: who added this animal, resolved for display.
                    addedByName: (animal.addedBy && teamNameMap[animal.addedBy]) || null,
                    lastUpdate,
                };
            })
        );

        // Deduplicate server-side to guarantee unique IDs
        const seen = new Set<string>();
        const deduped = enriched.filter((a: any) => {
            if (seen.has(a.id)) return false;
            seen.add(a.id);
            return true;
        });

        /* The last-updater is often NOT the owner, so `teamNameMap` (built
         * from addedBy before enrichment) doesn't cover them. One extra
         * resolve for the actors that actually appeared; fail-open to the
         * email handle the client already falls back to. */
        type WithLastUpdate = { lastUpdate?: { by: string; at: number; kind: string; name?: string | null } | null };
        try {
            const rows = deduped as WithLastUpdate[];
            const actors = Array.from(new Set(
                rows.map(a => a.lastUpdate?.by).filter((e): e is string => !!e)
            )).filter(e => !teamNameMap[e]);
            const extra = actors.length > 0
                ? await (await import('@/app/actions/userNames')).resolveUserNames(actors)
                : {};
            for (const a of rows) {
                if (a.lastUpdate?.by) a.lastUpdate.name = extra[a.lastUpdate.by] || teamNameMap[a.lastUpdate.by] || null;
            }
        } catch (e) {
            logger.warn('my-animals: lastUpdate name fallback', { userEmail, view, error: e instanceof Error ? e.message : String(e) });
        }

        return NextResponse.json(deduped);
    } catch (error) {
        const errorId = logger.error('API my-animals error', error, { userEmail, view });
        return NextResponse.json({ error: 'Failed to load animals', errorId }, { status: 500 });
    }
}
