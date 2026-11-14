/**
 * Reads behind the homepage modules. NOT a 'use server' module — the gated
 * entry point is getHomeModules (src/app/actions/homeModules.ts).
 *
 * Every number here is the number on the page the card opens, built from
 * that page's own scope and rules:
 * - adopters / posts: getOrgMemberEmails, as getMyAdopters (/my-adopters)
 * - animals: myAnimalsScope + animalFollowupsDue, as /api/my-animals; the
 *   applications to evaluate and the offers through applicationCounts (one
 *   grouped query per owner team), as «Con solicitudes por evaluar»
 *
 * Lean on purpose: counts and the few rows a card shows, never the whole
 * enriched list (the homepage is the most visited page).
 */
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { adopters, adoptions, adopterEvents, adopterImages } from '@/db/schema';
import { logger } from '@/lib/logger';
import { computeAvgRating } from '@/domain/ratings';
import { RECORD_TYPES } from '@/domain/constants';
import { homeAnimalRows, HOME_CARD_SLOTS, recentWithoutRequests } from '@/domain/homeModules';
import { takesContract } from '@/domain/placements';
import type { HomeAdoptersData, HomeAnimalsData, HomeAnimalRow, HomePendingItem, HomePostsData, HomePersonRow, HomeRequestItem } from '@/types/homeModules';

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

export async function loadHomeAdopters(db: Db, userEmail: string, memberEmails: string[], pendingReview: Promise<{ count: number; items: HomePendingItem[] }>, generalRequests: Promise<{ count: number; items: HomeRequestItem[] }>): Promise<HomeAdoptersData> {
    const log = { userEmail, op: 'loadHomeAdopters' };
    const scope = adopterScope(memberEmails);
    const [{ getOrgsForEmail, pickAttributionOrg }, { resolveDisplayName }] = await Promise.all([
        import('@/lib/orgMembership'),
        import('@/app/actions/notifications'),
    ]);

    // The rows the card lists, beside the total and the «pendientes» count.
    const rowsP = (async () => {
        const [recentRows, viewerOrgs, requests] = await Promise.all([
            // Twice the slots: the people already listed as a request row are left out (UX review S1).
            db.select({ id: adopters.id, name: adopters.name, source: adopters.source, addedBy: adopters.addedBy, createdAt: adopters.createdAt })
                .from(adopters).where(scope).orderBy(desc(adopters.createdAt)).limit(HOME_CARD_SLOTS * 2).all(),
            getOrgsForEmail(userEmail),
            generalRequests,
        ]);
        type Recent = { id: string; name: string | null; source: string | null; addedBy: string | null; createdAt: unknown };
        const recent = recentWithoutRequests(recentRows as Recent[], requests.items);
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

    const [totalRow, recent, pending, requests] = await Promise.all([
        db.select({ n: sql<number>`count(*)` }).from(adopters).where(scope).get(),
        rowsP,
        pendingReview,
        generalRequests,
    ]);
    return {
        total: Number((totalRow as { n: number } | undefined)?.n ?? 0), pendingReview: pending.count, pending: pending.items, recent,
        requestsToEvaluate: requests.count, requests: requests.items,
    };
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
    const [{ myAnimalsScope }, { loadAnimalActivityBulk, loadFollowupCtx, withDueFollowups, byRecentActivity }, { listApplicantIdsForAnimal }, { createOwnerTeamResolver }, { animalPrimaryFirst }, { countToEvaluateByAnimal, offerCountsByAnimal, healApplicationsOnce }, { normalizeTeamScope }, { runAfterResponse }] = await Promise.all([
        import('@/lib/myAnimalsScope'),
        import('@/lib/animalFollowupsDue'),
        import('@/app/actions/_applicants'),
        import('@/lib/ownerTeamResolver'),
        import('@/lib/showcase'),
        import('@/lib/applicationCounts'),
        import('@/lib/applicantScope'),
        import('@/lib/background'),
    ]);
    const [{ scopeEmails, adoptedWhere, availableWhere, placedWhere, allWhere }, followupCtx] = await Promise.all([
        myAnimalsScope(userEmail),
        loadFollowupCtx(db, userEmail, log),
    ]);

    const countOf = (where: typeof availableWhere) =>
        db.select({ n: sql<number>`count(DISTINCT ${adoptions.id})` }).from(adoptions).where(where).get()
            .then((r: { n: number } | undefined) => Number(r?.n ?? 0));
    type Animal = { id: string; animalName: string | null; species: string | null; sex: string | null; adopterId: string | null; recordType: string | null; addedBy: string | null; date: unknown };
    const cols = { id: adoptions.id, animalName: adoptions.animalName, species: adoptions.species, sex: adoptions.sex, adopterId: adoptions.adopterId, recordType: adoptions.recordType, addedBy: adoptions.addedBy, date: adoptions.date };
    const unique = (rows: Animal[]) => { const seen = new Set<string>(); return rows.filter(r => !seen.has(r.id) && seen.add(r.id)); };
    const ownerTeam = createOwnerTeamResolver();

    // The team's activity (4 queries): both the check-ups due and «last updated».
    const bulkP = loadAnimalActivityBulk(db, scopeEmails, log);
    // «Todos» — the same rows and order as /my-animals?view=todos.
    const allP: Promise<Animal[]> = db.select(cols).from(adoptions).where(allWhere).orderBy(sql`${adoptions.date} DESC`).all()
        .then((rows: Animal[]) => unique(rows));
    const recentP = Promise.all([bulkP, allP]).then(([bulk, rows]) => byRecentActivity(rows, bulk));
    // «Con controles pendientes» — the same scope as that tab (only when follow-ups are on).
    const dueP = followupCtx
        ? Promise.all([bulkP, db.select(cols).from(adoptions).where(placedWhere).orderBy(sql`${adoptions.date} DESC`).all()])
            .then(([bulk, rows]) => withDueFollowups(rows as Animal[], bulk, followupCtx, log))
        : Promise.resolve([]);

    // Applications to evaluate and offers to tell, per animal: ONE grouped query of each per
    // distinct owner team (org-mates share one), each animal read from its OWNER's team — as the
    // animal page and «Con solicitudes por evaluar» scope them. The viewer's own team (the owner
    // of most animals) is counted from the start, beside the «Todos» select; only an owner whose
    // team differs waits for the animals to be known. No heal write on this path: the missing
    // application rows are healed once the reads are done, after the response (runAfterResponse), through
    // the per-request memo (healApplicationsOnce) — one heal per team per request — for the next load.
    const nowSec = Math.floor(Date.now() / 1000);
    type Counts = { toEvaluate: Map<string, number>; offer: Map<string, number> };
    const noCounts: Counts = { toEvaluate: new Map(), offer: new Map() };
    const ownerKey = (email: string | null) => (email ?? '').trim().toLowerCase();
    const teamKey = (team: readonly string[]) => normalizeTeamScope(team).slice().sort().join(',');
    const noHeal = { heal: false };
    const toHeal = new Map<string, readonly string[]>();
    const perTeam = new Map<string, Promise<Counts>>();
    const startTeam = (key: string, team: readonly string[]) => {
        if (perTeam.has(key)) return;
        perTeam.set(key, Promise.all([
            countToEvaluateByAnimal(db, team, nowSec, noHeal)
                .catch((e: unknown) => { logger.warn('loadHomeAnimals: D1 fallback hit (to evaluate)', { ...log, team: key, error: errMsg(e) }); return new Map<string, number>(); }),
            offerCountsByAnimal(db, team)
                .catch((e: unknown) => { logger.warn('loadHomeAnimals: D1 fallback hit (offers)', { ...log, team: key, error: errMsg(e) }); return new Map<string, number>(); }),
        ]).then(([toEvaluate, offer]) => ({ toEvaluate, offer })));
        toHeal.set(key, team);
    };
    const viewer = ownerKey(userEmail);
    const viewerKey = teamKey(scopeEmails);
    startTeam(viewerKey, scopeEmails);
    const countsP = allP.then(async (rows) => {
        const owners = [...new Set(rows.map(r => ownerKey(r.addedBy)).filter(Boolean))];
        const keyOf = new Map<string, string>([[viewer, viewerKey]]);
        await Promise.all(owners.filter(o => o !== viewer).map(async (o) => {
            const team = await ownerTeam(o);
            const key = teamKey(team);
            keyOf.set(o, key);
            startTeam(key, team);
        }));
        const done = new Map(await Promise.all([...perTeam].map(async ([key, p]) => [key, await p] as const)));
        return (a: Animal) => {
            const c = done.get(keyOf.get(ownerKey(a.addedBy)) ?? '') ?? noCounts;
            // Applications are evaluated while the animal takes a contract (waiting for a home, or fostered).
            return { toEvaluate: takesContract(a) ? c.toEvaluate.get(a.id) ?? 0 : 0, offer: c.offer.get(a.id) ?? 0 };
        };
    });
    const [available, adopted, total, due, recent, countsOf] = await Promise.all([
        countOf(availableWhere), countOf(adoptedWhere), countOf(allWhere), dueP, recentP, countsP,
    ]);
    // The reads are done: heal each team's missing application rows after the response.
    const heals = [...toHeal].map(([key, team]) => runAfterResponse('loadHomeAnimals: heal missing applications',
        () => healApplicationsOnce(db, team), { ...log, team: key }));
    const offers = recent.filter(a => countsOf(a).offer > 0);
    // The animals with the most waiting first (then by name). General forms are people: «Mis adoptantes» (Jon 2026-11-13).
    const applications = recent.filter(a => countsOf(a).toEvaluate > 0)
        .sort((a, b) => countsOf(b).toEvaluate - countsOf(a).toEvaluate || (a.animalName ?? '').localeCompare(b.animalName ?? ''));
    const shown = homeAnimalRows({ offers, due, applications }, recent);

    // Only the rows shown are enriched, as the /my-animals card is: photo
    // (images[0] of the same order), the home it is in, applicants.
    const enrich = (a: Animal, dueInfo: HomeAnimalRow['due']): Promise<HomeAnimalRow> => {
        const status: HomeAnimalRow['status'] = a.recordType === RECORD_TYPES.FOSTER ? 'foster'
            : a.adopterId && a.recordType === RECORD_TYPES.ADOPTION ? 'adopted' : 'available';
        const { toEvaluate, offer } = countsOf(a);
        // The grey line (where it is, «N interesadas») shows only when no amber line takes its place.
        const grey = !dueInfo && toEvaluate === 0 && offer === 0;
        return Promise.all([
            db.select({ url: adopterImages.url }).from(adopterImages)
                .where(eq(adopterImages.adoptionId, a.id))
                .orderBy(animalPrimaryFirst(), sql`rowid ASC`).limit(1).get()
                .then((r: { url: string } | undefined) => r?.url ?? null)
                .catch((e: unknown) => { logger.warn('homeModules: animal photo fallback', { ...log, animalId: a.id, error: errMsg(e) }); return null; }),
            // The person's name only where the grey line shows it.
            grey && a.adopterId && status !== 'available'
                ? db.select({ name: adopters.name }).from(adopters).where(eq(adopters.id, a.adopterId)).get()
                    .then((r: { name: string | null } | undefined) => r?.name ?? null)
                    .catch((e: unknown) => { logger.warn('homeModules: home name fallback', { ...log, animalId: a.id, error: errMsg(e) }); return null; })
                : Promise.resolve(null),
            // Applicants exist while the animal still takes applications (waiting for a home, or fostered) — as on the card.
            grey && status !== 'adopted'
                ? ownerTeam(a.addedBy).then(team => listApplicantIdsForAnimal(db, a.id, team)).then(ids => ids.length)
                    .catch((e: unknown) => { logger.warn('homeModules: applicants fallback', { ...log, animalId: a.id, error: errMsg(e) }); return 0; })
                : Promise.resolve(0),
        ]).then(([photo, personName, applicants]) => ({
            id: a.id, name: a.animalName, species: a.species, sex: a.sex, photo, due: dueInfo, status, personName, applicants, toEvaluate, offer,
        }));
    };
    const rows = await Promise.all([
        ...shown.offers.map(a => enrich(a, null)),
        ...shown.due.map(a => enrich(a, { dueFollowups: a.dueFollowups, dueTop: a.dueTop })),
        ...shown.applications.map(a => enrich(a, null)),
        ...shown.recent.map(a => enrich(a, null)),
    ]);
    const solicitudesCount = recent.filter(a => countsOf(a).toEvaluate > 0).length;
    // Resolves at once where the platform keeps the worker alive (waitUntil); local dev waits, in parallel with the reads above.
    await Promise.all(heals);
    return {
        available, adopted, total, dueCount: due.length, moreDue: shown.moreDue,
        solicitudesCount, moreApplications: shown.moreApplications, rows,
    };
}
