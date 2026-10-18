/**
 * Review side of the API log (decisions 2 and 12): the admin's page sees every
 * key and transaction; a rescuer sees only their own. Server-only. The access
 * scoping lives HERE (an `ownerEmail` filter), so the two routes can't drift.
 */
import { and, desc, eq, gte, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { apiKeys, apiRequests, users } from '@/db/schema';
import { logger } from '@/lib/logger';
import { startOfUtcDay } from './handler';
import { environmentForHost, generateSecret, keyPrefixOf, sha256Hex } from './keys';
import { API_SCOPES, type ApiScope } from './schemas';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

export interface KeyView {
    id: string; name: string; ownerEmail: string; prefix: string; environment: string;
    scopes: string[]; dailyCapExact: number; dailyCapFuzzy: number;
    usedToday: { exact: number; fuzzy: number };
    /** Last 30 days: activities this key saved, and how many of them it voided (Jon, 2026-10-13: make search-then-void visible). */
    last30: { activities: number; voided: number };
    createdAt: string | null; lastUsedAt: string | null; revokedAt: string | null; revokedBy: string | null;
    selfService: boolean;
}

export const STATS_DAYS = 30;

/** Activities a key saved in the window (real saves, not dry runs) and how many were voided since. */
export async function keyActivityStats(db: Db, keyId: string, now = new Date()): Promise<{ activities: number; voided: number }> {
    const since = new Date(now.getTime() - STATS_DAYS * 86_400_000);
    const row = await db.select({
        activities: sql<number>`count(*)`,
        voided: sql<number>`sum(case when ${apiRequests.voidedAt} is not null then 1 else 0 end)`,
    }).from(apiRequests).where(and(
        eq(apiRequests.keyId, keyId), eq(apiRequests.endpoint, 'search'), eq(apiRequests.httpStatus, 200),
        isNotNull(apiRequests.recordId), eq(apiRequests.dryRun, 0), gte(apiRequests.createdAt, since),
    )).get() as { activities: number | null; voided: number | null } | undefined;
    return { activities: Number(row?.activities ?? 0), voided: Number(row?.voided ?? 0) };
}

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

export async function listKeys(db: Db, ownerEmail: string | null): Promise<KeyView[]> {
    const rows = await db.select().from(apiKeys)
        .where(ownerEmail ? eq(apiKeys.ownerEmail, ownerEmail) : undefined)
        .orderBy(desc(apiKeys.createdAt)).limit(500) as Array<typeof apiKeys.$inferSelect>;
    if (rows.length === 0) return [];
    // Batched (review 2026-10-17): one grouped read for today's use and one for the
    // last 30 days, instead of three queries per key.
    const since = new Date(Date.now() - STATS_DAYS * 86_400_000);
    const own = ownerEmail ? [eq(apiRequests.ownerEmail, ownerEmail)] : [];
    const [today, stats] = await Promise.all([
        db.select({ keyId: apiRequests.keyId, mode: apiRequests.mode, n: sql<number>`count(*)` }).from(apiRequests).where(and(
            ...own, eq(apiRequests.endpoint, 'search'), gte(apiRequests.createdAt, startOfUtcDay()), lt(apiRequests.httpStatus, 400),
            or(isNull(apiRequests.outcome), ne(apiRequests.outcome, 'replayed')),
        )).groupBy(apiRequests.keyId, apiRequests.mode).all() as Promise<Array<{ keyId: string; mode: string | null; n: number }>>,
        db.select({
            keyId: apiRequests.keyId,
            activities: sql<number>`count(*)`,
            // A void the person made (their key or Settings), not an admin's clean-up.
            voided: sql<number>`sum(case when ${apiRequests.voidedAt} is not null and (${apiRequests.voidedBy} = ${apiRequests.ownerEmail} or ${apiRequests.voidedBy} like 'api:%') then 1 else 0 end)`,
        }).from(apiRequests).where(and(
            ...own, eq(apiRequests.endpoint, 'search'), eq(apiRequests.httpStatus, 200),
            isNotNull(apiRequests.recordId), eq(apiRequests.dryRun, 0), gte(apiRequests.createdAt, since),
        )).groupBy(apiRequests.keyId).all() as Promise<Array<{ keyId: string; activities: number; voided: number }>>,
    ]);
    const used = new Map<string, { exact: number; fuzzy: number }>();
    for (const r of today) {
        const u = used.get(r.keyId) ?? { exact: 0, fuzzy: 0 };
        if (r.mode === 'exact' || r.mode === 'fuzzy') u[r.mode] = Number(r.n ?? 0);
        used.set(r.keyId, u);
    }
    const last30 = new Map(stats.map(r => [r.keyId, { activities: Number(r.activities ?? 0), voided: Number(r.voided ?? 0) }]));
    return rows.map(k => ({
        id: k.id, name: k.name, ownerEmail: k.ownerEmail, prefix: k.keyPrefix, environment: k.environment,
        scopes: parseJson<string[]>(k.scopes, [], 'api_keys.scopes', k.id), dailyCapExact: k.dailyCapExact, dailyCapFuzzy: k.dailyCapFuzzy,
        usedToday: k.revokedAt ? { exact: 0, fuzzy: 0 } : (used.get(k.id) ?? { exact: 0, fuzzy: 0 }),
        last30: last30.get(k.id) ?? { activities: 0, voided: 0 },
        createdAt: iso(k.createdAt), lastUsedAt: iso(k.lastUsedAt), revokedAt: iso(k.revokedAt), revokedBy: k.revokedBy ?? null,
        // Created by the rescuer at /developers (not issued by an admin to someone else).
        selfService: k.createdBy === k.ownerEmail,
    }));
}

function parseJson<T>(json: string | null, fallback: T, what: string, id: string): T {
    if (!json) return fallback;
    try { return JSON.parse(json) as T; } catch (e) {
        logger.warn('api review: unreadable JSON column', { what, id, error: e instanceof Error ? e.message : String(e) });
        return fallback;
    }
}

export interface TransactionFilter {
    ownerEmail?: string | null;   // forced for a rescuer; optional filter for the admin
    keyId?: string | null;
    outcome?: string | null;
    from?: Date | null;
    to?: Date | null;
    before?: PageCursor | null;   // pagination cursor (the last row seen)
    mode?: string | null;         // exact | fuzzy
    errorCode?: string | null;    // a refusal's error.code
    dryRun?: boolean | null;      // true: only test calls; false: only real ones
    q?: string | null;            // requestId, externalId, or a searched name / email / phone (within the 90 days)
}

export interface TransactionRow {
    id: string; keyId: string; keyName: string | null; ownerEmail: string; endpoint: string;
    mode: string | null; context: string | null; outcome: string | null; httpStatus: number;
    errorId: string | null; profileIds: string[]; recordId: string | null; profileCreated: boolean;
    externalId: string | null; voidedAt: string | null; voidedBy: string | null; dryRun: boolean;
    durationMs: number | null; createdAt: string;
    errorCode: string | null;
    /** Who the call searched for (from its stored request; null after the 90-day purge). */
    searched: { fullName: string | null; email: string | null; phone: string | null; documentId: string | null } | null;
}

/** What a call searched for, read from its stored request (kept 90 days). */
export function searchedPerson(requestBody: string | null): { fullName: string | null; email: string | null; phone: string | null; documentId: string | null } | null {
    if (!requestBody) return null;
    try {
        const p = (JSON.parse(requestBody) as { person?: Record<string, unknown> }).person;
        if (!p || typeof p !== 'object') return null;
        const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null);
        const doc = p.documentId && typeof p.documentId === 'object' ? s((p.documentId as { value?: unknown }).value) : null;
        return { fullName: s(p.fullName), email: s(p.email), phone: s(p.phone), documentId: doc };
    } catch { return null; } // a body that isn't JSON (the client sent garbage): nothing to show
}

function rowView(r: typeof apiRequests.$inferSelect, keyNames: Map<string, string>): TransactionRow {
    const profileIds = parseJson<string[]>(r.profileIds, [], 'api_requests.profile_ids', r.id);
    return {
        id: r.id, keyId: r.keyId, keyName: keyNames.get(r.keyId) ?? null, ownerEmail: r.ownerEmail, endpoint: r.endpoint,
        mode: r.mode, context: r.context, outcome: r.outcome, httpStatus: r.httpStatus, errorId: r.errorId,
        profileIds, recordId: r.recordId, profileCreated: r.profileCreated === 1, externalId: r.externalId, dryRun: r.dryRun === 1,
        voidedAt: iso(r.voidedAt), voidedBy: r.voidedBy, durationMs: r.durationMs, createdAt: iso(r.createdAt)!,
        errorCode: r.errorCode ?? null, searched: searchedPerson(r.requestBody),
    };
}

async function keyNameMap(db: Db, ownerEmail: string | null): Promise<Map<string, string>> {
    const keys = await db.select({ id: apiKeys.id, name: apiKeys.name }).from(apiKeys)
        .where(ownerEmail ? eq(apiKeys.ownerEmail, ownerEmail) : undefined) as Array<{ id: string; name: string }>;
    return new Map(keys.map(k => [k.id, k.name]));
}

export const TRANSACTION_PAGE = 50;

/**
 * A page cursor: "<createdAt ISO>|<id>". createdAt has one-second precision, so
 * a scripted partner's calls share seconds; the id breaks the tie and no row
 * at a page boundary is skipped. A bare ISO date (older clients) still works.
 */
export interface PageCursor { at: Date; id: string | null }
export function parseCursor(v: string | null | undefined): PageCursor | null {
    if (!v) return null;
    const [at, id] = v.split('|');
    const d = new Date(at);
    return Number.isNaN(d.getTime()) ? null : { at: d, id: id || null };
}
export function cursorCondition(c: PageCursor) {
    return c.id
        ? or(lt(apiRequests.createdAt, c.at), and(eq(apiRequests.createdAt, c.at), lt(apiRequests.id, c.id)))!
        : lt(apiRequests.createdAt, c.at);
}
export const cursorOf = (r: { createdAt: Date | null; id: string }) => `${iso(r.createdAt)}|${r.id}`;

export async function listTransactions(db: Db, f: TransactionFilter): Promise<{ rows: TransactionRow[]; nextBefore: string | null }> {
    const conds = [];
    if (f.ownerEmail) conds.push(eq(apiRequests.ownerEmail, f.ownerEmail));
    if (f.keyId) conds.push(eq(apiRequests.keyId, f.keyId));
    if (f.outcome) conds.push(eq(apiRequests.outcome, f.outcome));
    if (f.from) conds.push(gte(apiRequests.createdAt, f.from));
    if (f.to) conds.push(lt(apiRequests.createdAt, f.to));
    if (f.before) conds.push(cursorCondition(f.before));
    if (f.mode) conds.push(eq(apiRequests.mode, f.mode));
    if (f.errorCode) conds.push(eq(apiRequests.errorCode, f.errorCode));
    if (f.dryRun !== undefined && f.dryRun !== null) conds.push(eq(apiRequests.dryRun, f.dryRun ? 1 : 0));
    const q = f.q?.trim();
    if (q) {
        // One box: a requestId or an externalId exactly, or text inside the stored request
        // (a searched name, email or phone — only while the body exists, 90 days).
        const like = `%${q.replace(/[%_]/g, m => `\\${m}`)}%`;
        conds.push(or(eq(apiRequests.id, q), eq(apiRequests.externalId, q), sql`${apiRequests.requestBody} LIKE ${like} ESCAPE '\\'`)!);
    }
    const [rows, names] = await Promise.all([
        db.select().from(apiRequests).where(conds.length ? and(...conds) : undefined)
            .orderBy(desc(apiRequests.createdAt), desc(apiRequests.id)).limit(TRANSACTION_PAGE + 1),
        keyNameMap(db, f.ownerEmail ?? null),
    ]);
    const page = (rows as Array<typeof apiRequests.$inferSelect>).slice(0, TRANSACTION_PAGE);
    return {
        rows: page.map(r => rowView(r, names)),
        nextBefore: rows.length > TRANSACTION_PAGE ? cursorOf(page[page.length - 1]) : null,
    };
}

/** One transaction with its bodies. A rescuer only gets their own (else null). */
export async function getTransaction(db: Db, id: string, ownerEmail: string | null) {
    const conds = [eq(apiRequests.id, id)];
    if (ownerEmail) conds.push(eq(apiRequests.ownerEmail, ownerEmail));
    const r = await db.select().from(apiRequests).where(and(...conds)).get() as typeof apiRequests.$inferSelect | undefined;
    if (!r) return null;
    const names = await keyNameMap(db, ownerEmail);
    // A body that isn't JSON (the client sent garbage) is shown as the raw text it was.
    const parse = (s: string | null) => { if (!s) return null; try { return JSON.parse(s); } catch { return s; } };
    return { ...rowView(r, names), requestBody: parse(r.requestBody), responseBody: parse(r.responseBody) };
}

/** Admin: issue a key for an existing rescuer. The secret is returned once and never stored. */
export async function issueKey(db: Db, input: { ownerEmail: string; name: string; scopes?: string[]; dailyCapExact?: number; dailyCapFuzzy?: number }, host: string, createdBy: string) {
    const owner = await db.select({ email: users.email }).from(users).where(eq(users.email, input.ownerEmail.trim().toLowerCase())).get();
    if (!owner) return { error: 'unknown_owner' as const };
    // A blocked person gets no key, whoever issues it.
    const { isBlocked } = await import('./access');
    if (await isBlocked(db, owner.email)) return { error: 'blocked' as const };
    const scopes = (input.scopes?.length ? input.scopes : [...API_SCOPES]).filter((s): s is ApiScope => (API_SCOPES as readonly string[]).includes(s));
    const environment = environmentForHost(host);
    const secret = generateSecret(environment);
    const id = crypto.randomUUID();
    await db.insert(apiKeys).values({
        id, ownerEmail: owner.email, orgId: null, name: input.name.trim().slice(0, 80),
        keyHash: await sha256Hex(secret), keyPrefix: keyPrefixOf(secret), environment,
        scopes: JSON.stringify(scopes),
        dailyCapExact: clampCap(input.dailyCapExact, 500), dailyCapFuzzy: clampCap(input.dailyCapFuzzy, 50),
        createdBy, createdAt: new Date(),
    });
    return { id, secret, prefix: keyPrefixOf(secret), environment };
}

export function clampCap(v: unknown, fallback: number): number {
    // An emptied box is "no change", never 0 (review 2026-10-17: clearing a field silently zeroed a key).
    if (v === '' || v === null || v === undefined || (typeof v === 'string' && !v.trim())) return fallback;
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n >= 0 ? Math.min(n, 10_000) : fallback;
}

/**
 * Admin: a new secret for an existing key (a rescue lost theirs). Same key
 * row — name, owner, scopes, caps and its whole transaction history stay —
 * but the old secret stops working at once (only the new hash matches).
 * Secrets are never stored, so this is the only way to "see a key again".
 */
export async function regenerateKey(db: Db, id: string, host: string) {
    const key = await db.select().from(apiKeys).where(eq(apiKeys.id, id)).get() as typeof apiKeys.$inferSelect | undefined;
    if (!key) return { error: 'not_found' as const };
    if (key.revokedAt) return { error: 'revoked' as const };
    const environment = environmentForHost(host);
    const secret = generateSecret(environment);
    await db.update(apiKeys).set({ keyHash: await sha256Hex(secret), keyPrefix: keyPrefixOf(secret), environment }).where(eq(apiKeys.id, id));
    return { id, secret, prefix: keyPrefixOf(secret), environment, ownerEmail: key.ownerEmail, name: key.name };
}
