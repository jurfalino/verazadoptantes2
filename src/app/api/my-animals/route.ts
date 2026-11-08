import { NextResponse, NextRequest } from 'next/server';
import { auth } from '@/auth';
import { logger } from '@/lib/logger';
import { getFeatureFlag } from '@/config/features';
import { animalPrimaryFirst } from '@/lib/showcase';

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
        const { getDb } = await import('@/app/actions/_db');
        const db = await getDb();
        if (!db) {
            const errorId = logger.error('API my-animals: db unavailable', new Error('getDb returned null'), { userEmail, view });
            return NextResponse.json({ error: 'Database unavailable', errorId }, { status: 500 });
        }

        const { adoptions, adopterImages, adopters } = await import('@/db/schema');
        const { eq, sql, and } = await import('drizzle-orm');

        // Edit mode fetches ONE animal by id. Without this, the edit page pulled
        // the whole `view=all` list and enriched every row (2–3 D1 queries each) —
        // for a large rescuer (1000+ records) that's thousands of subrequests in
        // one request → past Cloudflare's Workers subrequest limit → 500.
        const idParam = searchParams.get('id');

        // The tabs' filters (team scope included), shared by the list queries,
        // ?counts=1 and the homepage card so a count never disagrees with its list.
        const { myAnimalsScope } = await import('@/lib/myAnimalsScope');
        const { scopeEmails, teamMatch, adoptedWhere, availableWhere, placedWhere, allWhere } = await myAnimalsScope(userEmail);

        // ?counts=1 — the two tabs' counts in one cheap call (the page fires it
        // on every tab switch), so the tab you are not on shows a number instead
        // of "(...)". DISTINCT id: the compat view can repeat an id (two open
        // placements), and the list dedupes by id. «Con controles pendientes»
        // needs the follow-up math, so its count rides on the list response
        // instead (x-pending-count below) rather than repeating the bulk read.
        if (searchParams.get('counts') === '1') {
            const countOf = (where: typeof availableWhere) =>
                db.select({ n: sql<number>`count(DISTINCT ${adoptions.id})` }).from(adoptions).where(where).get()
                    .then((r: { n: number } | undefined) => Number(r?.n ?? 0));
            const [available, adopted, all] = await Promise.all([countOf(availableWhere), countOf(adoptedWhere), countOf(allWhere)]);
            return NextResponse.json({ available, adopted, all });
        }

        // Due follow-ups: the «N pendientes» badge, the «Con controles
        // pendientes» tab and its count. The bulk read is 4 queries TOTAL,
        // independent of N (the per-row fan-out once pushed large rescuers
        // toward the Workers subrequest limit). It also feeds «Actualizado
        // por», so list views always load it. Skipped for ?id= (one row, not the set).
        const { loadAnimalActivityBulk, loadFollowupCtx, dueForAnimal, withDueFollowups, animalLastUpdate, byRecentActivity } = await import('@/lib/animalFollowupsDue');
        const log = { userEmail, view };
        const followupCtx = idParam ? null : await loadFollowupCtx(db, userEmail, log);
        const bulk = idParam ? null : await loadAnimalActivityBulk(db, scopeEmails, log);
        /** Placed animals with a follow-up due now, most overdue first. `select` reads full rows for the list, or only id/adopterId/date for the count. */
        const pendingRows = <R extends { id: string; adopterId: string | null; date: unknown }>(select: () => Promise<R[]>) => followupCtx
            ? select().then(rows => withDueFollowups(rows, bulk, followupCtx, log))
            : Promise.resolve([]);

        let results;
        if (idParam) {
            results = await db.select().from(adoptions)
                .where(and(teamMatch, eq(adoptions.id, idParam)))
                .all();
        } else if (view === 'pendientes') {
            // Already deduped and most-overdue first; enrichment below keeps the order.
            results = await pendingRows(() => db.select().from(adoptions).where(placedWhere).orderBy(sql`${adoptions.date} DESC`).all());
        } else if (view === 'adopted') {
            results = await db.select().from(adoptions)
                .where(adoptedWhere)
                .orderBy(sql`${adoptions.date} DESC`)
                .all();
        } else if (view === 'todos') {
            // «Todos»: both tabs; reordered below by last update, newest first.
            results = await db.select().from(adoptions)
                .where(allWhere)
                .orderBy(sql`${adoptions.date} DESC`)
                .all();
        } else if (view === 'all') {
            // All animals by this user's team (for edit mode lookups)
            results = await db.select().from(adoptions)
                .where(teamMatch)
                .orderBy(sql`${adoptions.date} DESC`)
                .all();
        } else {
            results = await db.select().from(adoptions)
                .where(availableWhere)
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

        // «N interesadas» chip: applicants of each AVAILABLE animal, scoped to
        // the animal OWNER's team — the exact rule the animal page lists with
        // (src/lib/applicantScope.ts), so the chip and the page never disagree.
        // Access is already implied: every row here passed `teamMatch`, so the
        // viewer is the owner or an org-mate. Each distinct owner's team is
        // resolved ONCE per request, and the card only needs the count, so this
        // is one id-select per available animal — no per-card auth/org checks
        // and no per-applicant enrichment (that payload, with contact details,
        // is the animal page's job).
        const { createOwnerTeamResolver, listApplicantIdsForAnimal } = await import('@/app/actions/_applicants');
        const ownerTeam = createOwnerTeamResolver();

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
                    caption: adopterImages.caption,
                    // v2.56.127: the card predicts whether a PUBLIC page
                    // exists for this animal. The public read keeps only
                    // scope 'animal' and drops a posterless video, so without
                    // these three the card promises a page that 404s.
                    scope: adopterImages.scope,
                    mediaType: adopterImages.mediaType,
                    thumbnailUrl: adopterImages.thumbnailUrl
                })
                    .from(adopterImages)
                    .where(eq(adopterImages.adoptionId, animal.id))
                    .orderBy(animalPrimaryFirst(), sql`rowid ASC`)
                    .limit(5)
                    .all()
                    .catch((e: unknown) => {
                        logger.warn('my-animals: images fallback', { animalId: animal.id, userEmail, view, error: e instanceof Error ? e.message : String(e) });
                        return [] as { id: string; url: string; caption: string | null; scope: string | null; mediaType: string | null; thumbnailUrl: string | null }[];
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
                const applicants: Array<{ submissionId: string }> = animal.adopterId ? [] : await ownerTeam(animal.addedBy)
                    .then(team => listApplicantIdsForAnimal(db, animal.id, team))
                    .catch((e: unknown) => {
                        logger.warn('my-animals: applicants fallback', { animalId: animal.id, userEmail, view, error: e instanceof Error ? e.message : String(e) });
                        return [];
                    });

                // Due follow-ups for the badge — only animals with an active
                // placement can have any (src/lib/animalFollowupsDue.ts).
                const { dueFollowups, dueTop } = dueForAnimal(animal, bulk, followupCtx, log);

                // v2.56.16: who last touched this animal, and when (src/lib/animalFollowupsDue.ts).
                const lastUpdate = animalLastUpdate(animal, bulk);

                return {
                    ...animal, images, adopterName, applicants, dueFollowups, dueTop,
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

        // H1: each signed contract's id, for «Datos y posibles duplicados» (batched; fails open to the PDF alone).
        // Every row here is the viewer's team's (`teamMatch`) — the PDF's audience.
        const { attachSignedContractIds } = await import('@/lib/signedContractIds');
        const withContracts = await attachSignedContractIds(db, deduped as Array<{ id: string; hasContract?: number | null }>, { op: 'my-animals', userEmail, view });

        // «Todos» reads newest activity first — the homepage card's order
        // (byRecentActivity), so «Ver los N animales» lands on the same list.
        const listed = view === 'todos' ? byRecentActivity(withContracts as Array<{ id: string; addedBy?: string | null; date?: unknown }>, bulk) : withContracts;

        // The «Con controles pendientes» tab count, from the bulk this request
        // already read (one narrow extra select). Only for the tab lists.
        const headers: Record<string, string> = {};
        if (!idParam && view !== 'all') {
            const pending = view === 'pendientes'
                ? deduped.length
                : (await pendingRows(() => db.select({ id: adoptions.id, adopterId: adoptions.adopterId, date: adoptions.date })
                    .from(adoptions).where(placedWhere).all())).length;
            headers['x-pending-count'] = String(pending);
        }
        return NextResponse.json(listed, { headers });
    } catch (error) {
        const errorId = logger.error('API my-animals error', error, { userEmail, view, counts: searchParams.get('counts') === '1' });
        return NextResponse.json({ error: 'Failed to load animals', errorId }, { status: 500 });
    }
}
