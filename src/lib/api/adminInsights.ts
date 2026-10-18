/**
 * Admin → API, supervision (senior-EM review 2026-10-17): the Overview numbers,
 * the People list (one row per person with API access or keys) and a person's
 * detail — daily use, the names they searched, their keys. Server-only; the
 * routes are admin-only.
 */
import { and, count, desc, eq, gte, isNotNull, lt, sql } from 'drizzle-orm';
import { apiAccess, apiKeys, apiRequests, users } from '@/db/schema';
import { getFeatureFlag } from '@/config/features';
import { getAccess, type AccessStatus } from './access';
import { listKeys, searchedPerson } from './review';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

const DAY_MS = 86_400_000;
export const PEOPLE_PAGE = 50;
export const SEARCHES_PAGE = 50;
/** Heavy fuzzy use: most of a self-service key's fuzzy limit, every day, for a week (and more). */
export const HEAVY_FUZZY_7D = 200;

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : typeof v === 'number' ? new Date(v * 1000).toISOString() : null);
/** A void the person made (their key, or Settings) — not an admin's clean-up. */
const ownVoid = sql`(${apiRequests.voidedAt} IS NOT NULL AND (${apiRequests.voidedBy} = ${apiRequests.ownerEmail} OR ${apiRequests.voidedBy} LIKE 'api:%'))`;

export function manyVoids(saved: number, voided: number): boolean {
    return voided >= 3 && voided / Math.max(1, saved) >= 0.2;
}

// ── Overview ──────────────────────────────────────────────────────────────

async function windowCounts(db: Db, since: Date) {
    const row = await db.select({
        calls: count(),
        clientErrors: sql<number>`SUM(CASE WHEN ${apiRequests.httpStatus} BETWEEN 400 AND 499 THEN 1 ELSE 0 END)`,
        serverErrors: sql<number>`SUM(CASE WHEN ${apiRequests.httpStatus} >= 500 THEN 1 ELSE 0 END)`,
        unavailable: sql<number>`SUM(CASE WHEN ${apiRequests.errorCode} = 'temporarily_unavailable' THEN 1 ELSE 0 END)`,
        capHits: sql<number>`SUM(CASE WHEN ${apiRequests.errorCode} = 'daily_cap_reached' THEN 1 ELSE 0 END)`,
        ceilingHits: sql<number>`SUM(CASE WHEN ${apiRequests.errorCode} = 'daily_call_ceiling_reached' THEN 1 ELSE 0 END)`,
    }).from(apiRequests).where(gte(apiRequests.createdAt, since)).get();
    const n = (v: unknown) => Number(v ?? 0);
    return { calls: n(row?.calls), clientErrors: n(row?.clientErrors), serverErrors: n(row?.serverErrors), unavailable: n(row?.unavailable), capHits: n(row?.capHits), ceilingHits: n(row?.ceilingHits) };
}

export async function apiOverview(db: Db, now = new Date()) {
    const since7 = new Date(now.getTime() - 7 * DAY_MS);
    const [enabled, pending, last24h, last7d, topFuzzy] = await Promise.all([
        getFeatureFlag('ENABLE_PUBLIC_API'),
        db.select({ n: count() }).from(apiAccess).where(eq(apiAccess.status, 'requested')).get(),
        windowCounts(db, new Date(now.getTime() - DAY_MS)),
        windowCounts(db, since7),
        db.select({ email: apiRequests.ownerEmail, fuzzy: count() }).from(apiRequests)
            .where(and(gte(apiRequests.createdAt, since7), eq(apiRequests.mode, 'fuzzy'), lt(apiRequests.httpStatus, 400)))
            .groupBy(apiRequests.ownerEmail).orderBy(desc(count())).limit(5).all(),
    ]);
    return { enabled, pendingRequests: Number(pending?.n ?? 0), last24h, last7d, topFuzzy7d: topFuzzy as Array<{ email: string; fuzzy: number }> };
}

// ── People ────────────────────────────────────────────────────────────────

export interface PersonRow {
    email: string; name: string | null;
    access: AccessStatus; tool: string | null; requestedAt: string | null;
    activeKeys: number;
    last30: { exact: number; fuzzy: number; saved: number; voided: number; errors: number };
    fuzzy7d: number;
    badges: Array<'heavy_fuzzy' | 'many_voids'>;
}

export interface PeopleFilter { status?: string | null; badge?: string | null; q?: string | null; sort?: string | null; page?: number }

export async function listPeople(db: Db, f: PeopleFilter, now = new Date()): Promise<{ rows: PersonRow[]; total: number; page: number; pages: number }> {
    const since30 = new Date(now.getTime() - 30 * DAY_MS);
    const since7 = new Date(now.getTime() - 7 * DAY_MS);
    const [access, keys, usage, fuzzy7] = await Promise.all([
        db.select().from(apiAccess).all() as Promise<Array<typeof apiAccess.$inferSelect>>,
        db.select({ email: apiKeys.ownerEmail, active: sql<number>`SUM(CASE WHEN ${apiKeys.revokedAt} IS NULL THEN 1 ELSE 0 END)` })
            .from(apiKeys).groupBy(apiKeys.ownerEmail).all() as Promise<Array<{ email: string; active: number }>>,
        db.select({
            email: apiRequests.ownerEmail,
            exact: sql<number>`SUM(CASE WHEN ${apiRequests.mode} = 'exact' AND ${apiRequests.httpStatus} < 400 THEN 1 ELSE 0 END)`,
            fuzzy: sql<number>`SUM(CASE WHEN ${apiRequests.mode} = 'fuzzy' AND ${apiRequests.httpStatus} < 400 THEN 1 ELSE 0 END)`,
            saved: sql<number>`SUM(CASE WHEN ${apiRequests.recordId} IS NOT NULL AND ${apiRequests.dryRun} = 0 THEN 1 ELSE 0 END)`,
            voided: sql<number>`SUM(CASE WHEN ${ownVoid} THEN 1 ELSE 0 END)`,
            errors: sql<number>`SUM(CASE WHEN ${apiRequests.httpStatus} >= 400 THEN 1 ELSE 0 END)`,
        }).from(apiRequests).where(gte(apiRequests.createdAt, since30)).groupBy(apiRequests.ownerEmail).all() as Promise<Array<{ email: string; exact: number; fuzzy: number; saved: number; voided: number; errors: number }>>,
        db.select({ email: apiRequests.ownerEmail, n: count() }).from(apiRequests)
            .where(and(gte(apiRequests.createdAt, since7), eq(apiRequests.mode, 'fuzzy'), lt(apiRequests.httpStatus, 400)))
            .groupBy(apiRequests.ownerEmail).all() as Promise<Array<{ email: string; n: number }>>,
    ]);
    const emails = new Set<string>([...access.map(a => a.userEmail), ...keys.map(k => k.email)]);
    const accessBy = new Map(access.map(a => [a.userEmail, a]));
    const keysBy = new Map(keys.map(k => [k.email, Number(k.active ?? 0)]));
    const usageBy = new Map(usage.map(u => [u.email, u]));
    const fuzzyBy = new Map(fuzzy7.map(u => [u.email, Number(u.n ?? 0)]));

    let rows: PersonRow[] = [...emails].map(email => {
        const a = accessBy.get(email);
        const u = usageBy.get(email);
        const last30 = { exact: Number(u?.exact ?? 0), fuzzy: Number(u?.fuzzy ?? 0), saved: Number(u?.saved ?? 0), voided: Number(u?.voided ?? 0), errors: Number(u?.errors ?? 0) };
        const fuzzy7d = fuzzyBy.get(email) ?? 0;
        const badges: PersonRow['badges'] = [];
        if (fuzzy7d >= HEAVY_FUZZY_7D) badges.push('heavy_fuzzy');
        if (manyVoids(last30.saved, last30.voided)) badges.push('many_voids');
        return {
            email, name: null,
            access: (a?.status ?? (keysBy.get(email) ? 'approved' : 'none')) as AccessStatus,
            tool: a?.tool ?? null, requestedAt: iso(a?.requestedAt),
            activeKeys: keysBy.get(email) ?? 0, last30, fuzzy7d, badges,
        };
    });
    if (f.status) rows = rows.filter(r => r.access === f.status);
    if (f.badge) rows = rows.filter(r => r.badges.includes(f.badge as PersonRow['badges'][number]));
    const q = f.q?.trim().toLowerCase();
    // Names come from the user table, fetched only for the rows that can show.
    const names = new Map<string, string | null>();
    const fetchNames = async (list: string[]) => {
        await Promise.all(list.filter(e => !names.has(e)).map(async e => {
            const u = await db.select({ name: users.name }).from(users).where(eq(users.email, e)).get();
            names.set(e, u?.name ?? null);
        }));
    };
    if (q) {
        await fetchNames(rows.map(r => r.email));
        rows = rows.filter(r => r.email.toLowerCase().includes(q) || (names.get(r.email) ?? '').toLowerCase().includes(q));
    }
    const sort = f.sort ?? 'fuzzy';
    rows.sort((a, b) => sort === 'requested'
        ? (b.requestedAt ?? '').localeCompare(a.requestedAt ?? '')
        : sort === 'email' ? a.email.localeCompare(b.email)
            // default: pending requests first, then heaviest fuzzy use
            : (Number(b.access === 'requested') - Number(a.access === 'requested')) || (b.fuzzy7d - a.fuzzy7d) || (b.last30.fuzzy - a.last30.fuzzy));
    const total = rows.length;
    const pages = Math.max(1, Math.ceil(total / PEOPLE_PAGE));
    const page = Math.min(Math.max(1, f.page ?? 1), pages);
    const slice = rows.slice((page - 1) * PEOPLE_PAGE, page * PEOPLE_PAGE);
    await fetchNames(slice.map(r => r.email));
    return { rows: slice.map(r => ({ ...r, name: names.get(r.email) ?? null })), total, page, pages };
}

// ── One person ────────────────────────────────────────────────────────────

export async function personDetail(db: Db, email: string, opts: { before?: Date | null } = {}, now = new Date()) {
    const since30 = new Date(now.getTime() - 30 * DAY_MS);
    const searchConds = [eq(apiRequests.ownerEmail, email), eq(apiRequests.endpoint, 'search'), isNotNull(apiRequests.requestBody)];
    if (opts.before) searchConds.push(lt(apiRequests.createdAt, opts.before));
    const [access, user, keys, daily, searches] = await Promise.all([
        getAccess(db, email),
        db.select({ name: users.name }).from(users).where(eq(users.email, email)).get(),
        listKeys(db, email),
        db.select({
            day: sql<string>`date(${apiRequests.createdAt}, 'unixepoch')`,
            exact: sql<number>`SUM(CASE WHEN ${apiRequests.mode} = 'exact' AND ${apiRequests.httpStatus} < 400 THEN 1 ELSE 0 END)`,
            fuzzy: sql<number>`SUM(CASE WHEN ${apiRequests.mode} = 'fuzzy' AND ${apiRequests.httpStatus} < 400 THEN 1 ELSE 0 END)`,
            errors: sql<number>`SUM(CASE WHEN ${apiRequests.httpStatus} >= 400 THEN 1 ELSE 0 END)`,
        }).from(apiRequests).where(and(eq(apiRequests.ownerEmail, email), gte(apiRequests.createdAt, since30)))
            .groupBy(sql`date(${apiRequests.createdAt}, 'unixepoch')`).all(),
        db.select({
            id: apiRequests.id, createdAt: apiRequests.createdAt, mode: apiRequests.mode, outcome: apiRequests.outcome,
            httpStatus: apiRequests.httpStatus, dryRun: apiRequests.dryRun, requestBody: apiRequests.requestBody,
        }).from(apiRequests).where(and(...searchConds)).orderBy(desc(apiRequests.createdAt)).limit(SEARCHES_PAGE + 1).all(),
    ]);
    const page = (searches as Array<{ id: string; createdAt: unknown; mode: string | null; outcome: string | null; httpStatus: number; dryRun: number; requestBody: string | null }>).slice(0, SEARCHES_PAGE);
    return {
        email, name: user?.name ?? null, access, keys,
        daily: (daily as Array<{ day: string; exact: number; fuzzy: number; errors: number }>).map(d => ({ day: d.day, exact: Number(d.exact ?? 0), fuzzy: Number(d.fuzzy ?? 0), errors: Number(d.errors ?? 0) })),
        searches: page.map(r => ({
            requestId: r.id, createdAt: iso(r.createdAt), mode: r.mode, outcome: r.outcome, httpStatus: r.httpStatus, dryRun: r.dryRun === 1,
            searched: searchedPerson(r.requestBody),
        })),
        nextBefore: searches.length > SEARCHES_PAGE ? iso(page[page.length - 1].createdAt) : null,
    };
}
