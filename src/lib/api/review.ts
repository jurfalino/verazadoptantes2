/**
 * Review side of the API log (decisions 2 and 12): the admin's page sees every
 * key and transaction; a rescuer sees only their own. Server-only. The access
 * scoping lives HERE (an `ownerEmail` filter), so the two routes can't drift.
 */
import { and, desc, eq, gte, lt } from 'drizzle-orm';
import { apiKeys, apiRequests, users } from '@/db/schema';
import { logger } from '@/lib/logger';
import { searchesToday } from './handler';
import { environmentForHost, generateSecret, keyPrefixOf, sha256Hex } from './keys';
import { API_SCOPES, type ApiScope } from './schemas';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

export interface KeyView {
    id: string; name: string; ownerEmail: string; prefix: string; environment: string;
    scopes: string[]; dailyCapExact: number; dailyCapFuzzy: number;
    usedToday: { exact: number; fuzzy: number };
    createdAt: string | null; lastUsedAt: string | null; revokedAt: string | null;
}

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

export async function listKeys(db: Db, ownerEmail: string | null): Promise<KeyView[]> {
    const rows = await db.select().from(apiKeys)
        .where(ownerEmail ? eq(apiKeys.ownerEmail, ownerEmail) : undefined)
        .orderBy(desc(apiKeys.createdAt)).limit(200) as Array<typeof apiKeys.$inferSelect>;
    return Promise.all(rows.map(async k => ({
        id: k.id, name: k.name, ownerEmail: k.ownerEmail, prefix: k.keyPrefix, environment: k.environment,
        scopes: parseJson<string[]>(k.scopes, [], 'api_keys.scopes', k.id), dailyCapExact: k.dailyCapExact, dailyCapFuzzy: k.dailyCapFuzzy,
        usedToday: k.revokedAt ? { exact: 0, fuzzy: 0 } : {
            exact: await searchesToday(db, k.id, 'exact'),
            fuzzy: await searchesToday(db, k.id, 'fuzzy'),
        },
        createdAt: iso(k.createdAt), lastUsedAt: iso(k.lastUsedAt), revokedAt: iso(k.revokedAt),
    })));
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
    before?: Date | null;         // pagination cursor (createdAt of the last row seen)
}

export interface TransactionRow {
    id: string; keyId: string; keyName: string | null; ownerEmail: string; endpoint: string;
    mode: string | null; context: string | null; outcome: string | null; httpStatus: number;
    errorId: string | null; profileIds: string[]; recordId: string | null; profileCreated: boolean;
    externalId: string | null; voidedAt: string | null; voidedBy: string | null;
    durationMs: number | null; createdAt: string;
}

function rowView(r: typeof apiRequests.$inferSelect, keyNames: Map<string, string>): TransactionRow {
    const profileIds = parseJson<string[]>(r.profileIds, [], 'api_requests.profile_ids', r.id);
    return {
        id: r.id, keyId: r.keyId, keyName: keyNames.get(r.keyId) ?? null, ownerEmail: r.ownerEmail, endpoint: r.endpoint,
        mode: r.mode, context: r.context, outcome: r.outcome, httpStatus: r.httpStatus, errorId: r.errorId,
        profileIds, recordId: r.recordId, profileCreated: r.profileCreated === 1, externalId: r.externalId,
        voidedAt: iso(r.voidedAt), voidedBy: r.voidedBy, durationMs: r.durationMs, createdAt: iso(r.createdAt)!,
    };
}

async function keyNameMap(db: Db, ownerEmail: string | null): Promise<Map<string, string>> {
    const keys = await db.select({ id: apiKeys.id, name: apiKeys.name }).from(apiKeys)
        .where(ownerEmail ? eq(apiKeys.ownerEmail, ownerEmail) : undefined) as Array<{ id: string; name: string }>;
    return new Map(keys.map(k => [k.id, k.name]));
}

export const TRANSACTION_PAGE = 50;

export async function listTransactions(db: Db, f: TransactionFilter): Promise<{ rows: TransactionRow[]; nextBefore: string | null }> {
    const conds = [];
    if (f.ownerEmail) conds.push(eq(apiRequests.ownerEmail, f.ownerEmail));
    if (f.keyId) conds.push(eq(apiRequests.keyId, f.keyId));
    if (f.outcome) conds.push(eq(apiRequests.outcome, f.outcome));
    if (f.from) conds.push(gte(apiRequests.createdAt, f.from));
    if (f.to) conds.push(lt(apiRequests.createdAt, f.to));
    if (f.before) conds.push(lt(apiRequests.createdAt, f.before));
    const [rows, names] = await Promise.all([
        db.select().from(apiRequests).where(conds.length ? and(...conds) : undefined)
            .orderBy(desc(apiRequests.createdAt)).limit(TRANSACTION_PAGE + 1),
        keyNameMap(db, f.ownerEmail ?? null),
    ]);
    const page = (rows as Array<typeof apiRequests.$inferSelect>).slice(0, TRANSACTION_PAGE);
    return {
        rows: page.map(r => rowView(r, names)),
        nextBefore: rows.length > TRANSACTION_PAGE ? iso(page[page.length - 1].createdAt) : null,
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
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n >= 0 ? Math.min(n, 10_000) : fallback;
}
