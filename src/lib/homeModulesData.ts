/**
 * Reads behind the homepage modules. NOT a 'use server' module — the gated
 * entry point is getHomeModules (src/app/actions/homeModules.ts).
 *
 * Every number here is the number on the page the card opens, built from
 * that page's own scope and rules:
 * - adopters / posts: getOrgMemberEmails, as getMyAdopters (/my-adopters)
 * - animals: myAnimalsScope + animalFollowupsDue, as /api/my-animals
 *
 * Lean on purpose: counts and the few rows a card shows, never the whole
 * enriched list (the homepage is the most visited page).
 */
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { adopters, adoptions, adopterEvents, adopterImages, formSubmissions } from '@/db/schema';
import { logger } from '@/lib/logger';
import { computeAvgRating } from '@/domain/ratings';
import { summarizeAdopterForms } from '@/domain/formLink';
import { RECORD_TYPES } from '@/domain/constants';
import { loadFormContext } from '@/lib/adopterFormContext';
import type { HomeAdoptersData, HomeAnimalsData, HomePostsData, HomePersonRow } from '@/types/homeModules';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the Drizzle D1/better-sqlite3 union getDb() returns
type Db = any;

const toMs = (v: unknown): number => v instanceof Date ? v.getTime() : typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : 0;
const errMsg = (e: unknown) => e instanceof Error ? e.message : String(e);

/** /my-adopters' row scope: created by anyone in the viewer's groups, not merged away. */
function adopterScope(memberEmails: string[]) {
    const memberList = sql.join(memberEmails.map((e) => sql`${e}`), sql`, `);
    return and(sql`${adopters.addedBy} IN (${memberList})`, isNull(adopters.deletedAt));
}

/**
 * Avatar + rating for a few people, by the same rules as /my-adopters:
 * the profile picture (else the newest profile-level image) and the average
 * of rated records. A failed read degrades to no avatar / no rating (logged).
 */
async function personBits(db: Db, ids: string[], log: Record<string, unknown>): Promise<Map<string, Pick<HomePersonRow, 'thumbnail' | 'avgRating'>>> {
    const out = new Map<string, Pick<HomePersonRow, 'thumbnail' | 'avgRating'>>();
    await Promise.all(ids.map(async (id) => {
        const [img, records] = await Promise.all([
            db.select({ url: adopterImages.url }).from(adopterImages)
                .where(and(eq(adopterImages.adopterId, id), or(isNull(adopterImages.adoptionId), eq(adopterImages.isProfilePicture, 1))))
                .orderBy(sql`${adopterImages.isProfilePicture} DESC, ${adopterImages.uploadedAt} DESC`)
                .limit(1).get()
                .catch((e: unknown) => { logger.warn('homeModules: avatar fallback', { ...log, adopterId: id, error: errMsg(e) }); return undefined; }),
            db.select({ rating: adoptions.rating }).from(adoptions).where(eq(adoptions.adopterId, id)).all()
                .catch((e: unknown) => { logger.warn('homeModules: rating fallback', { ...log, adopterId: id, error: errMsg(e) }); return []; }),
        ]);
        out.set(id, { thumbnail: (img as { url: string } | undefined)?.url ?? null, avgRating: computeAvgRating(records as Array<{ rating: number | null }>) });
    }));
    return out;
}

export async function loadHomeAdopters(db: Db, userEmail: string, memberEmails: string[], pendingReview: number): Promise<HomeAdoptersData> {
    const log = { userEmail, op: 'loadHomeAdopters' };
    const scope = adopterScope(memberEmails);
    const { getOrgsForEmail, pickAttributionOrg } = await import('@/lib/orgMembership');
    const [totalRow, recentRows, myForms, viewerOrgs] = await Promise.all([
        db.select({ n: sql<number>`count(*)` }).from(adopters).where(scope).get(),
        db.select({ id: adopters.id, name: adopters.name, source: adopters.source, addedBy: adopters.addedBy, createdAt: adopters.createdAt })
            .from(adopters).where(scope).orderBy(desc(adopters.createdAt)).limit(3).all(),
        // «Por revisar» only ever depends on the viewer's own forms (summarizeAdopterForms).
        db.select({
            id: formSubmissions.id, userId: formSubmissions.userId, linkedAdopterId: formSubmissions.linkedAdopterId,
            autoAdopterId: formSubmissions.autoAdopterId, createdAt: formSubmissions.createdAt, selectedAnimalId: formSubmissions.selectedAnimalId,
        }).from(formSubmissions)
            .innerJoin(adopters, eq(adopters.id, formSubmissions.linkedAdopterId))
            .where(and(eq(formSubmissions.userId, userEmail), scope)).all(),
        getOrgsForEmail(userEmail),
    ]);

    const { formsByAdopter, liveMatchCounts } = await loadFormContext(db, myForms, userEmail);
    let formsToReview = 0;
    for (const forms of formsByAdopter.values()) {
        if (summarizeAdopterForms(forms, userEmail, (id) => liveMatchCounts.get(id) ?? 0).needsReview) formsToReview++;
    }

    type Recent = { id: string; name: string | null; source: string | null; addedBy: string | null; createdAt: unknown };
    const recent = recentRows as Recent[];
    const multiGroup = viewerOrgs.length >= 2;
    const bits = await personBits(db, recent.map(r => r.id), log);
    const { resolveDisplayName } = await import('@/app/actions/notifications');
    const rows = await Promise.all(recent.map(async (r) => {
        const creator = r.addedBy && r.addedBy !== 'anonymous' ? r.addedBy : null;
        const creatorIsSelf = creator === userEmail;
        const [creatorName, org] = await Promise.all([
            creator && !creatorIsSelf ? resolveDisplayName(creator) : Promise.resolve(null),
            creator && multiGroup ? pickAttributionOrg(creator, userEmail) : Promise.resolve(null),
        ]);
        return {
            id: r.id,
            name: r.name,
            ...(bits.get(r.id) ?? { thumbnail: null, avgRating: null }),
            createdAt: toMs(r.createdAt),
            viaForm: r.source === 'form',
            creatorIsSelf,
            creatorName,
            groupName: org?.name ?? null,
        };
    }));

    return { total: Number((totalRow as { n: number } | undefined)?.n ?? 0), pendingReview, formsToReview, recent: rows };
}

export async function loadHomePosts(db: Db, userEmail: string, memberEmails: string[]): Promise<HomePostsData> {
    const log = { userEmail, op: 'loadHomePosts' };
    // The observations that carry a post link (isPostRecord, in SQL), on people
    // /my-adopters lists. Aggregated in D1: a count, the newest date and two rows.
    const isPost = and(
        eq(adopterEvents.eventType, RECORD_TYPES.OBSERVATION),
        or(sql`lower(trim(${adopterEvents.sourceUrl})) LIKE 'http://%'`, sql`lower(trim(${adopterEvents.sourceUrl})) LIKE 'https://%'`),
    );
    // Joined with adopters (the scope reads adopters.added_by / deleted_at).
    const postWhere = and(adopterScope(memberEmails), isPost);
    const [summary, newest] = await Promise.all([
        db.select({ people: sql<number>`count(DISTINCT ${adopterEvents.adopterId})`, last: sql<number | null>`max(${adopterEvents.createdAt})` })
            .from(adopterEvents).innerJoin(adopters, eq(adopters.id, adopterEvents.adopterId))
            .where(postWhere).get(),
        // The newest post per person, two people.
        db.select({ adopterId: adopterEvents.adopterId, name: adopters.name, at: sql<number>`max(${adopterEvents.createdAt})` })
            .from(adopterEvents).innerJoin(adopters, eq(adopters.id, adopterEvents.adopterId))
            .where(postWhere).groupBy(adopterEvents.adopterId)
            .orderBy(sql`max(${adopterEvents.createdAt}) DESC`).limit(2).all(),
    ]);
    type Newest = { adopterId: string; name: string | null; at: unknown };
    const people = newest as Newest[];
    const [bits, links] = await Promise.all([
        personBits(db, people.map(p => p.adopterId), log),
        // That post's link, for the network name.
        Promise.all(people.map(p => db.select({ sourceUrl: adopterEvents.sourceUrl }).from(adopterEvents)
            .where(and(eq(adopterEvents.adopterId, p.adopterId), isPost))
            .orderBy(desc(adopterEvents.createdAt)).limit(1).get()
            .then((r: { sourceUrl: string | null } | undefined) => (r?.sourceUrl || '').trim())
            .catch((e: unknown) => { logger.warn('homeModules: post link fallback', { ...log, adopterId: p.adopterId, error: errMsg(e) }); return ''; }))),
    ]);
    const s = summary as { people: number; last: unknown } | undefined;
    return {
        people: Number(s?.people ?? 0),
        lastPostAt: s?.last != null ? toMs(s.last) : null,
        recent: people.map((p, i) => ({
            id: p.adopterId,
            name: p.name,
            ...(bits.get(p.adopterId) ?? { thumbnail: null, avgRating: null }),
            at: toMs(p.at),
            sourceUrl: links[i],
        })),
    };
}

export async function loadHomeAnimals(db: Db, userEmail: string): Promise<HomeAnimalsData> {
    const log = { userEmail, op: 'loadHomeAnimals' };
    const { myAnimalsScope } = await import('@/lib/myAnimalsScope');
    const { loadAnimalActivityBulk, loadFollowupCtx, withDueFollowups } = await import('@/lib/animalFollowupsDue');
    const { scopeEmails, adoptedWhere, availableWhere, placedWhere } = await myAnimalsScope(userEmail);

    const countOf = (where: typeof availableWhere) =>
        db.select({ n: sql<number>`count(DISTINCT ${adoptions.id})` }).from(adoptions).where(where).get()
            .then((r: { n: number } | undefined) => Number(r?.n ?? 0));
    const followupCtx = await loadFollowupCtx(db, userEmail, log);
    const [available, adopted, bulk, placedRows, listedRows] = await Promise.all([
        countOf(availableWhere),
        countOf(adoptedWhere),
        followupCtx ? loadAnimalActivityBulk(db, scopeEmails, log) : Promise.resolve(null),
        followupCtx
            ? db.select({ id: adoptions.id, animalName: adoptions.animalName, adopterId: adoptions.adopterId, date: adoptions.date })
                .from(adoptions).where(placedWhere).orderBy(sql`${adoptions.date} DESC`).all()
            : Promise.resolve([]),
        // Same order as the «Disponibles» tab; a few extra rows absorb compat-view repeats.
        db.select({ id: adoptions.id, animalName: adoptions.animalName, species: adoptions.species, adopterId: adoptions.adopterId, recordType: adoptions.recordType, addedBy: adoptions.addedBy })
            .from(adoptions).where(availableWhere).orderBy(sql`${adoptions.date} DESC`).limit(8).all(),
    ]);

    const due = withDueFollowups(placedRows as Array<{ id: string; animalName: string | null; adopterId: string | null; date: unknown }>, bulk, followupCtx, log)
        .map(r => ({ id: r.id, name: r.animalName, dueFollowups: r.dueFollowups, dueTop: r.dueTop }));

    type Listed = { id: string; animalName: string | null; species: string | null; adopterId: string | null; recordType: string | null; addedBy: string | null };
    const seen = new Set<string>();
    const firstThree = (listedRows as Listed[]).filter(r => !seen.has(r.id) && seen.add(r.id)).slice(0, 3);
    const { createOwnerTeamResolver, listApplicantIdsForAnimal } = await import('@/app/actions/_applicants');
    const { animalPrimaryFirst } = await import('@/lib/showcase');
    const ownerTeam = createOwnerTeamResolver();
    const listed = await Promise.all(firstThree.map(async (a) => {
        const [photo, fosterName, applicants] = await Promise.all([
            // The /my-animals card shows images[0] of this same order.
            db.select({ url: adopterImages.url }).from(adopterImages)
                .where(eq(adopterImages.adoptionId, a.id))
                .orderBy(animalPrimaryFirst(), sql`rowid ASC`).limit(1).get()
                .then((r: { url: string } | undefined) => r?.url ?? null)
                .catch((e: unknown) => { logger.warn('homeModules: animal photo fallback', { ...log, animalId: a.id, error: errMsg(e) }); return null; }),
            a.adopterId
                ? db.select({ name: adopters.name }).from(adopters).where(eq(adopters.id, a.adopterId)).get()
                    .then((r: { name: string | null } | undefined) => r?.name ?? null)
                    .catch((e: unknown) => { logger.warn('homeModules: foster name fallback', { ...log, animalId: a.id, error: errMsg(e) }); return null; })
                : Promise.resolve(null),
            // Applicants exist only while the animal waits for a home — as on the card.
            a.adopterId
                ? Promise.resolve(0)
                : ownerTeam(a.addedBy).then(team => listApplicantIdsForAnimal(db, a.id, team)).then(ids => ids.length)
                    .catch((e: unknown) => { logger.warn('homeModules: applicants fallback', { ...log, animalId: a.id, error: errMsg(e) }); return 0; }),
        ]);
        return { id: a.id, name: a.animalName, species: a.species, photo, fosterName: a.recordType === RECORD_TYPES.FOSTER ? fosterName : null, applicants };
    }));

    return { available, adopted, due, listed };
}

