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
import { adopters, adoptions, adopterEvents, adopterImages } from '@/db/schema';
import { logger } from '@/lib/logger';
import { computeAvgRating } from '@/domain/ratings';
import { RECORD_TYPES } from '@/domain/constants';
import { homeAnimalRows } from '@/domain/homeModules';
import type { HomeAdoptersData, HomeAnimalsData, HomeAnimalRow, HomePostsData, HomePersonRow } from '@/types/homeModules';

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

export async function loadHomeAdopters(db: Db, userEmail: string, memberEmails: string[], pendingReview: Promise<number>): Promise<HomeAdoptersData> {
    const log = { userEmail, op: 'loadHomeAdopters' };
    const scope = adopterScope(memberEmails);
    const [{ getOrgsForEmail, pickAttributionOrg }, { resolveDisplayName }] = await Promise.all([
        import('@/lib/orgMembership'),
        import('@/app/actions/notifications'),
    ]);

    // The rows the card lists, beside the total and the «pendientes» count.
    const rowsP = (async () => {
        const [recentRows, viewerOrgs] = await Promise.all([
            db.select({ id: adopters.id, name: adopters.name, source: adopters.source, addedBy: adopters.addedBy, createdAt: adopters.createdAt })
                .from(adopters).where(scope).orderBy(desc(adopters.createdAt)).limit(3).all(),
            getOrgsForEmail(userEmail),
        ]);
        type Recent = { id: string; name: string | null; source: string | null; addedBy: string | null; createdAt: unknown };
        const recent = recentRows as Recent[];
        const multiGroup = viewerOrgs.length >= 2;
        const [bits, people] = await Promise.all([
            personBits(db, recent.map(r => r.id), log),
            Promise.all(recent.map(async (r) => {
                const creator = r.addedBy && r.addedBy !== 'anonymous' ? r.addedBy : null;
                const creatorIsSelf = creator === userEmail;
                const [creatorName, org] = await Promise.all([
                    creator && !creatorIsSelf ? resolveDisplayName(creator) : Promise.resolve(null),
                    creator && multiGroup ? pickAttributionOrg(creator, userEmail) : Promise.resolve(null),
                ]);
                return { creatorIsSelf, creatorName, groupName: org?.name ?? null };
            })),
        ]);
        return recent.map((r, i) => ({
            id: r.id,
            name: r.name,
            ...(bits.get(r.id) ?? { thumbnail: null, avgRating: null }),
            createdAt: toMs(r.createdAt),
            viaForm: r.source === 'form',
            ...people[i],
        }));
    })();

    const [totalRow, recent, pending] = await Promise.all([
        db.select({ n: sql<number>`count(*)` }).from(adopters).where(scope).get(),
        rowsP,
        pendingReview,
    ]);
    return { total: Number((totalRow as { n: number } | undefined)?.n ?? 0), pendingReview: pending, recent };
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
    const [{ myAnimalsScope }, { loadAnimalActivityBulk, loadFollowupCtx, withDueFollowups, byRecentActivity }, { createOwnerTeamResolver, listApplicantIdsForAnimal }, { animalPrimaryFirst }] = await Promise.all([
        import('@/lib/myAnimalsScope'),
        import('@/lib/animalFollowupsDue'),
        import('@/app/actions/_applicants'),
        import('@/lib/showcase'),
    ]);
    const [{ scopeEmails, adoptedWhere, availableWhere, placedWhere, allWhere }, followupCtx] = await Promise.all([
        myAnimalsScope(userEmail),
        loadFollowupCtx(db, userEmail, log),
    ]);

    const countOf = (where: typeof availableWhere) =>
        db.select({ n: sql<number>`count(DISTINCT ${adoptions.id})` }).from(adoptions).where(where).get()
            .then((r: { n: number } | undefined) => Number(r?.n ?? 0));
    type Animal = { id: string; animalName: string | null; species: string | null; adopterId: string | null; recordType: string | null; addedBy: string | null; date: unknown };
    const cols = { id: adoptions.id, animalName: adoptions.animalName, species: adoptions.species, adopterId: adoptions.adopterId, recordType: adoptions.recordType, addedBy: adoptions.addedBy, date: adoptions.date };
    const unique = (rows: Animal[]) => { const seen = new Set<string>(); return rows.filter(r => !seen.has(r.id) && seen.add(r.id)); };

    // The team's activity (4 queries): both the check-ups due and «last updated».
    const bulkP = loadAnimalActivityBulk(db, scopeEmails, log);
    // «Todos» — the same rows and order as /my-animals?view=todos.
    const recentP = Promise.all([bulkP, db.select(cols).from(adoptions).where(allWhere).orderBy(sql`${adoptions.date} DESC`).all()])
        .then(([bulk, rows]) => byRecentActivity(unique(rows as Animal[]), bulk));
    // «Con controles pendientes» — the same scope as that tab (only when follow-ups are on).
    const dueP = followupCtx
        ? Promise.all([bulkP, db.select(cols).from(adoptions).where(placedWhere).orderBy(sql`${adoptions.date} DESC`).all()])
            .then(([bulk, rows]) => withDueFollowups(rows as Animal[], bulk, followupCtx, log))
        : Promise.resolve([]);

    const [available, adopted, total, due, recent] = await Promise.all([
        countOf(availableWhere), countOf(adoptedWhere), countOf(allWhere), dueP, recentP,
    ]);
    const shown = homeAnimalRows(due, recent);

    // Only the rows shown are enriched, as the /my-animals card is: photo
    // (images[0] of the same order), the home it is in, applicants.
    const ownerTeam = createOwnerTeamResolver();
    const enrich = (a: Animal, dueInfo: HomeAnimalRow['due']): Promise<HomeAnimalRow> => {
        const status: HomeAnimalRow['status'] = a.recordType === RECORD_TYPES.FOSTER ? 'foster'
            : a.adopterId && a.recordType === RECORD_TYPES.ADOPTION ? 'adopted' : 'available';
        return Promise.all([
            db.select({ url: adopterImages.url }).from(adopterImages)
                .where(eq(adopterImages.adoptionId, a.id))
                .orderBy(animalPrimaryFirst(), sql`rowid ASC`).limit(1).get()
                .then((r: { url: string } | undefined) => r?.url ?? null)
                .catch((e: unknown) => { logger.warn('homeModules: animal photo fallback', { ...log, animalId: a.id, error: errMsg(e) }); return null; }),
            // The person's name only where the grey line shows it.
            !dueInfo && a.adopterId && status !== 'available'
                ? db.select({ name: adopters.name }).from(adopters).where(eq(adopters.id, a.adopterId)).get()
                    .then((r: { name: string | null } | undefined) => r?.name ?? null)
                    .catch((e: unknown) => { logger.warn('homeModules: home name fallback', { ...log, animalId: a.id, error: errMsg(e) }); return null; })
                : Promise.resolve(null),
            // Applicants exist only while the animal waits for a home — as on the card.
            !dueInfo && status === 'available'
                ? ownerTeam(a.addedBy).then(team => listApplicantIdsForAnimal(db, a.id, team)).then(ids => ids.length)
                    .catch((e: unknown) => { logger.warn('homeModules: applicants fallback', { ...log, animalId: a.id, error: errMsg(e) }); return 0; })
                : Promise.resolve(0),
        ]).then(([photo, personName, applicants]) => ({
            id: a.id, name: a.animalName, species: a.species, photo, due: dueInfo, status, personName, applicants,
        }));
    };
    const rows = await Promise.all([
        ...shown.due.map(a => enrich(a, { dueFollowups: a.dueFollowups, dueTop: a.dueTop })),
        ...shown.recent.map(a => enrich(a, null)),
    ]);
    return { available, adopted, total, dueCount: due.length, rows };
}

