/**
 * One wrapper for every /api/v1 endpoint: feature flag, key, error shape,
 * transaction log, daily caps and idempotent replay. Server-only.
 *
 * Every call made with a valid key leaves exactly one `api_requests` row: that
 * row is what the admin page and the rescuer's own log review, what a key's
 * daily cap counts, and what a void checks ("did this key create the record?").
 */
import { NextResponse } from 'next/server';
import { and, eq, gte, ne, count, lt, isNotNull, isNull, max, or } from 'drizzle-orm';
import { apiKeys, apiRequests } from '@/db/schema';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { runAfterResponse } from '@/lib/background';
import { getFeatureFlag } from '@/config/features';
import { bearerSecret, environmentForHost, findActiveKey, importModeOn, IMPORT_CALL_CEILING, scopesOf, type ApiKeyRow } from './keys';
import { keyAccess, PENDING_APPROVAL_CAPS, withPendingCaps, type KeyAccess } from './access';
import type { ApiErrorCode, ApiScope } from './schemas';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

export type ApiEndpoint = 'search' | 'me' | 'void' | 'contract' | 'requests';

/**
 * Test calls that save nothing: `X-Dry-Run: 1` runs a search end to end —
 * validation, scopes, Idempotency-Key, caps, the found / not_found / ambiguous
 * decision — but writes no record, profile or notification. For partners
 * building an integration, on STAGING only (Jon, 2026-10-15): a `ba_test_` key
 * on a non-production host. In production every exact search leaves a record,
 * whoever's key it is, so the header is refused (403) there — never silently
 * saved, since the developer believes nothing is being written. Documented.
 */
export const DRY_RUN_HEADER = 'x-dry-run';
export function wantsDryRun(value: string | null): boolean {
    return value != null && /^(1|true|yes)$/i.test(value.trim());
}
/** May this call be a dry run? Only a test key on a non-production host. Pure. */
export function dryRunAllowed(keyEnvironment: string, host: string): boolean {
    return keyEnvironment === 'test' && environmentForHost(host) === 'test';
}

/** Person data the client sent is kept this long, then dropped from the log. */
export const REQUEST_BODY_RETENTION_DAYS = 90;
/** The slim row (who, when, which profiles, result) is deleted after a year — by the daily cron, workers/followup-cron — unless the call saved a record. */
export const API_LOG_RETENTION_DAYS = 365;
/** Whole request kept for review (an adoption form's answers included), then purged as above. */
const MAX_LOGGED_BODY = 64_000;
/** A call is a few hundred bytes, plus up to 50 KB of form answers (FORM_CONTENT_MAX_BYTES). */
const MAX_REQUEST_BODY = 64_000;
/** A save takes seconds; a claim still open after this was abandoned by a dead worker. */
const ABANDONED_CLAIM_MS = 120_000;

/** Extra, machine-readable fields of an error (all optional). */
export interface ApiErrorExtra {
    field?: string;
    details?: Array<{ code: string; field: string; message: string }>;
    originalRequestId?: string;
    activityId?: string;
    profileId?: string;
}

export class ApiError extends Error {
    constructor(public status: number, public code: ApiErrorCode, message: string, public headers: Record<string, string> = {}, public extra: ApiErrorExtra = {}) {
        super(message);
    }
}

/** Where the docs explain errors (the guide's «Errores» section). */
export function errorDocUrl(origin: string): string {
    return `${origin}/api/v1/docs#description/errores`;
}

/** What an endpoint wants written to its transaction row. */
export interface LogFields {
    mode?: 'exact' | 'fuzzy' | null;
    context?: string | null;
    outcome?: string | null;
    profileIds?: string[];
    recordId?: string | null;
    profileCreated?: boolean;
    externalId?: string | null;
    /** Contacts this call added to a known profile (void takes them back). */
    contactsAdded?: Array<{ entryId: string; field: string }>;
}

export interface ApiCallContext {
    db: Db;
    key: ApiKeyRow;
    scopes: ApiScope[];
    requestId: string;
    /** Public origin of this deployment, for links back to the HTML pages. */
    origin: string;
    /** Raw request body (already read), for the log and idempotency. */
    bodyText: string;
    /** A file upload's bytes (binary endpoints only); never logged. */
    bodyBytes: ArrayBuffer | null;
    /** What makes a saving call a retry: `ext:<externalId>` (set by the search once the body is read). */
    idempotencyKey: string | null;
    log: LogFields;
    /** Set when this call already owns a log row (idempotency claim). */
    rowClaimed: boolean;
    /** X-Dry-Run (staging, test keys): nothing is written but its log row. */
    dryRun: boolean;
    /** The request URL's query (GET endpoints). */
    query: URLSearchParams;
    /** A self-created key whose owner is not approved yet: PENDING_APPROVAL_CAPS apply (key already lowered). */
    limited: boolean;
    /** Today's counts as read by enforceDailyCap (this call not included), reused for the RateLimit headers. */
    caps?: CapSnapshot;
}

export interface CapSnapshot { mode: 'exact' | 'fuzzy'; byKey: number; byPerson: number; personCap: number }

/** What is left once this call is counted, from counts read before it ran. Pure. */
export function remainingFrom(snap: CapSnapshot, keyCap: number, counted: boolean): { limit: number; remaining: number } {
    const byKey = snap.byKey + (counted ? 1 : 0), byPerson = snap.byPerson + (counted ? 1 : 0);
    const personLimit = Math.max(snap.personCap, keyCap);
    const remaining = Math.max(0, Math.min(keyCap - byKey, personLimit - byPerson));
    return { limit: personLimit - byPerson < keyCap - byKey ? personLimit : keyCap, remaining };
}

export interface ApiResult { status: number; body: Record<string, unknown> }

function json(status: number, body: Record<string, unknown>, requestId: string, headers: Record<string, string> = {}) {
    return NextResponse.json(body, {
        status,
        headers: { 'x-request-id': requestId, 'cache-control': 'no-store', ...headers },
    });
}

function errorBody(requestId: string, origin: string, code: string, message: string, errorId?: string, extra: ApiErrorExtra = {}) {
    return { requestId, error: { code, message, ...extra, docUrl: errorDocUrl(origin), ...(errorId ? { errorId } : {}) } };
}

export function requireScope(ctx: ApiCallContext, scope: ApiScope) {
    if (!ctx.scopes.includes(scope)) throw new ApiError(403, 'forbidden', `this key lacks the ${scope} scope`);
}

/** Start of today, UTC: caps reset with the free-tier quotas, at 00:00 UTC. */
export function startOfUtcDay(now = new Date()): Date {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Searches of one mode this key made today that count against its cap: the
 * ones that ran (a refused call — any 4xx — and a replay of an earlier answer
 * don't; a call still in progress, status 0, does).
 */
export async function searchesToday(db: Db, keyId: string, mode: 'exact' | 'fuzzy'): Promise<number> {
    const row = await db.select({ n: count() }).from(apiRequests).where(and(
        eq(apiRequests.keyId, keyId),
        eq(apiRequests.endpoint, 'search'),
        eq(apiRequests.mode, mode),
        gte(apiRequests.createdAt, startOfUtcDay()),
        lt(apiRequests.httpStatus, 400),
        or(isNull(apiRequests.outcome), ne(apiRequests.outcome, 'replayed')),
    )).get();
    return row?.n ?? 0;
}

function secondsToUtcMidnight(now = new Date()): number {
    return Math.ceil((startOfUtcDay(now).getTime() + 86_400_000 - now.getTime()) / 1000);
}

function retryAfterMidnight(): Record<string, string> {
    return { 'Retry-After': String(secondsToUtcMidnight()) };
}

/** A person's searches of one mode today, across ALL their keys (revoked ones included). */
export async function personSearchesToday(db: Db, ownerEmail: string, mode: 'exact' | 'fuzzy'): Promise<number> {
    const row = await db.select({ n: count() }).from(apiRequests).where(and(
        eq(apiRequests.ownerEmail, ownerEmail),
        eq(apiRequests.endpoint, 'search'),
        eq(apiRequests.mode, mode),
        gte(apiRequests.createdAt, startOfUtcDay()),
        lt(apiRequests.httpStatus, 400),
        or(isNull(apiRequests.outcome), ne(apiRequests.outcome, 'replayed')),
    )).get();
    return row?.n ?? 0;
}

/**
 * A person's daily limit across all their keys: the highest cap among their
 * active keys (review 2026-10-17: revoke-and-recreate multiplied the per-key
 * limit without end). Admin-issued partner keys keep their own higher caps.
 */
export async function personCap(db: Db, ownerEmail: string, mode: 'exact' | 'fuzzy', limited = false): Promise<number> {
    const col = mode === 'exact' ? apiKeys.dailyCapExact : apiKeys.dailyCapFuzzy;
    if (!limited) {
        const row = await db.select({ cap: max(col) }).from(apiKeys).where(and(eq(apiKeys.ownerEmail, ownerEmail), isNull(apiKeys.revokedAt))).get();
        return row?.cap ?? 0;
    }
    // Not approved yet: their own keys count at the pending limit, so several keys
    // share one small allowance (an admin-issued key keeps its own cap).
    const pending = PENDING_APPROVAL_CAPS[mode];
    const rows = await db.select({ cap: col, createdBy: apiKeys.createdBy }).from(apiKeys)
        .where(and(eq(apiKeys.ownerEmail, ownerEmail), isNull(apiKeys.revokedAt))).all() as Array<{ cap: number; createdBy: string | null }>;
    return rows.reduce((m, r) => Math.max(m, r.createdBy === ownerEmail ? Math.min(r.cap, pending) : r.cap), 0);
}

/** What is left today for this key: the smaller of the key's and the person's remainder. */
export async function remainingToday(db: Db, key: ApiKeyRow, mode: 'exact' | 'fuzzy', limited = false): Promise<{ limit: number; remaining: number }> {
    const keyCap = mode === 'exact' ? key.dailyCapExact : key.dailyCapFuzzy;
    const [byKey, byPerson, cap] = await Promise.all([searchesToday(db, key.id, mode), personSearchesToday(db, key.ownerEmail, mode), personCap(db, key.ownerEmail, mode, limited)]);
    // The limit that binds: the person's when their other keys used it up, else the key's own.
    return remainingFrom({ mode, byKey, byPerson, personCap: cap }, keyCap, false);
}

/**
 * Checked BEFORE an idempotency claim, so a refused call never becomes the stored
 * answer. The three counts are read at once and kept for the RateLimit headers
 * (they were read twice per call, one after another — 2026-10-18).
 */
export async function enforceDailyCap(ctx: ApiCallContext, mode: 'exact' | 'fuzzy') {
    const cap = mode === 'exact' ? ctx.key.dailyCapExact : ctx.key.dailyCapFuzzy;
    const [byKey, byPerson, ownerCap] = await Promise.all([
        searchesToday(ctx.db, ctx.key.id, mode), personSearchesToday(ctx.db, ctx.key.ownerEmail, mode), personCap(ctx.db, ctx.key.ownerEmail, mode, ctx.limited),
    ]);
    ctx.caps = { mode, byKey, byPerson, personCap: ownerCap };
    // Not approved yet: say why the limit is low and how it goes up.
    const pendingNote = ctx.limited ? ' (limit until a BuenAdoptante admin approves your access request at /developers)' : '';
    if (byKey >= cap) {
        throw new ApiError(429, 'daily_cap_reached', `daily ${mode} cap of ${cap} reached${pendingNote}; resets at 00:00 UTC`, retryAfterMidnight());
    }
    const perPerson = Math.max(ownerCap, cap);
    if (byPerson >= perPerson) {
        throw new ApiError(429, 'daily_cap_reached', `daily ${mode} limit of ${perPerson} reached across all your keys${pendingNote}; resets at 00:00 UTC`, retryAfterMidnight());
    }
}

/**
 * A ceiling on EVERY call a key makes in a day (bad JSON, /me, refused calls
 * included): each one is a request against the account-wide free quota and a
 * log row, so a client stuck in a loop must stop long before the site does.
 */
export const DAILY_CALL_CEILING_FLOOR = 1000;
export function callCeilingOf(key: Pick<ApiKeyRow, 'dailyCapExact' | 'dailyCapFuzzy'>): number {
    return Math.max(DAILY_CALL_CEILING_FLOOR, 2 * (key.dailyCapExact + key.dailyCapFuzzy));
}
/** Every call this key made today, of any kind. */
export async function callsToday(db: Db, keyId: string): Promise<number> {
    const row = await db.select({ n: count() }).from(apiRequests)
        .where(and(eq(apiRequests.keyId, keyId), gte(apiRequests.createdAt, startOfUtcDay()))).get();
    return row?.n ?? 0;
}
async function enforceCallCeiling(db: Db, key: ApiKeyRow) {
    const ceiling = importModeOn(key) ? IMPORT_CALL_CEILING : callCeilingOf(key);
    if (await callsToday(db, key.id) >= ceiling) {
        throw new ApiError(429, 'daily_call_ceiling_reached', `this key made ${ceiling} calls today (of any kind), its daily ceiling; resets at 00:00 UTC`, retryAfterMidnight());
    }
}

/**
 * Same JSON regardless of key order, spacing, a field sent as null instead of
 * left out, and spaces around a value (the API trims them anyway) — so a retry
 * rebuilt by another library still matches. Array order still matters.
 */
export function canonicalJson(text: string | null): string | null {
    if (text === null) return null;
    let v: unknown;
    try { v = JSON.parse(text); } catch { return text; }
    const norm = (x: unknown): unknown => {
        if (Array.isArray(x)) return x.map(norm);
        if (typeof x === 'string') return x.trim();
        if (x && typeof x === 'object') {
            return Object.fromEntries(Object.keys(x as object).sort()
                .filter(k => (x as Record<string, unknown>)[k] !== null && (x as Record<string, unknown>)[k] !== undefined)
                .map(k => [k, norm((x as Record<string, unknown>)[k])]));
        }
        return x;
    };
    return JSON.stringify(norm(v));
}

type ApiRequestRow = typeof apiRequests.$inferSelect;

/**
 * Idempotent saves, step 1 (read-only): did an earlier call with this key save
 * the same externalId? A retry with the same content gets the stored answer; a
 * different content is refused, naming what was saved. An earlier call that
 * crashed (5xx) before writing anything is released so the retry runs again;
 * one that crashed AFTER creating a profile or record is not (a rerun would
 * duplicate it): the answer names what exists, to void before retrying.
 */
export async function replayIdempotent(ctx: ApiCallContext, opts: { readOnly?: boolean } = {}): Promise<ApiResult | null> {
    if (!ctx.idempotencyKey) return null;
    const where = and(eq(apiRequests.keyId, ctx.key.id), eq(apiRequests.idempotencyKey, ctx.idempotencyKey));
    const prior = await ctx.db.select().from(apiRequests).where(where).get() as ApiRequestRow | undefined;
    if (!prior) return null;
    const firstProfile = (() => { try { return (JSON.parse(prior.profileIds ?? '[]') as string[])[0]; } catch { return undefined; } })();
    const saved: ApiErrorExtra = {
        originalRequestId: prior.id,
        ...(prior.recordId ? { activityId: prior.recordId } : {}),
        ...(firstProfile ? { profileId: firstProfile } : {}),
    };
    // Partial = an activity exists. A crash that only created the profile is
    // released: the retry finds that profile by the same identifiers (it was
    // indexed when created) and adds the activity to it — no duplicate.
    const partial = !!prior.recordId;
    // A claim nobody finished (the worker died mid-call) counts as a crash.
    const abandoned = prior.httpStatus === 0 && Date.now() - new Date(prior.createdAt).getTime() > ABANDONED_CLAIM_MS;
    if ((prior.httpStatus >= 500 || abandoned) && !partial) {
        if (!opts.readOnly) await ctx.db.delete(apiRequests).where(eq(apiRequests.id, prior.id));
        return null;
    }
    if (prior.httpStatus >= 500 || abandoned) {
        throw new ApiError(409, 'partially_saved', 'an earlier call with this externalId stopped after saving part of the data; void that activity (or ask an admin) and send the call again — voiding frees the externalId', {}, saved);
    }
    if (prior.httpStatus === 0) {
        throw new ApiError(409, 'request_in_progress', 'a call with this externalId is still being processed; retry in a few seconds', { 'Retry-After': '2' }, { originalRequestId: prior.id });
    }
    if (prior.requestBody === null) {
        throw new ApiError(409, 'external_id_expired', 'this externalId was saved more than 90 days ago and can no longer be replayed; use a new externalId for a new activity', {}, saved);
    }
    if (canonicalJson(prior.requestBody) !== canonicalJson(ctx.bodyText.slice(0, MAX_LOGGED_BODY))) {
        throw new ApiError(409, 'external_id_reused', 'this externalId was already saved with different content; use a new externalId, or void the earlier activity first', {}, saved);
    }
    logger.info('api: idempotent replay', { requestId: ctx.requestId, originalRequestId: prior.id, keyId: ctx.key.id });
    const body = prior.responseBody ? JSON.parse(prior.responseBody) as Record<string, unknown> : {};
    return { status: prior.httpStatus, body: { ...body, replayed: true, originalRequestId: prior.id } };
}

/**
 * Write what a saving call has done SO FAR onto its claimed row, the moment it
 * happens: if the worker dies before the final log write, a retry must still
 * see that a profile / activity exists (and never save it twice).
 */
export async function recordProgress(ctx: ApiCallContext, fields: { profileCreated?: boolean; profileIds?: string[]; recordId?: string }): Promise<void> {
    if (!ctx.rowClaimed) return;
    try {
        await ctx.db.update(apiRequests).set({
            ...(fields.profileCreated ? { profileCreated: 1 } : {}),
            ...(fields.profileIds ? { profileIds: JSON.stringify(fields.profileIds) } : {}),
            ...(fields.recordId ? { recordId: fields.recordId } : {}),
        }).where(eq(apiRequests.id, ctx.requestId));
    } catch (e) {
        logger.error('api: progress write failed (a retry may not see what this call saved)', e, { requestId: ctx.requestId, keyId: ctx.key.id, ...fields });
    }
}

/** Idempotent saves, step 2: own the key (unique on key + idempotency key) before writing anything. */
export async function claimIdempotencyKey(ctx: ApiCallContext): Promise<void> {
    if (!ctx.idempotencyKey) return;
    try {
        await ctx.db.insert(apiRequests).values({
            id: ctx.requestId, keyId: ctx.key.id, ownerEmail: ctx.key.ownerEmail, endpoint: 'search',
            mode: ctx.log.mode ?? null, context: ctx.log.context ?? null,
            httpStatus: 0, idempotencyKey: ctx.idempotencyKey, createdAt: new Date(),
        });
    } catch (e) {
        // Lost a race with a concurrent identical request.
        logger.warn('api: idempotency claim lost a race', { requestId: ctx.requestId, keyId: ctx.key.id, error: e instanceof Error ? e.message : String(e) });
        throw new ApiError(409, 'request_in_progress', 'a call with this externalId is still being processed; retry in a few seconds', { 'Retry-After': '2' });
    }
    ctx.rowClaimed = true;
}

async function writeLog(ctx: ApiCallContext, endpoint: ApiEndpoint, status: number, body: Record<string, unknown>, errorId: string | null, startedAt: number) {
    const values = {
        keyId: ctx.key.id,
        ownerEmail: ctx.key.ownerEmail,
        endpoint,
        mode: ctx.log.mode ?? null,
        context: ctx.log.context ?? null,
        // A refused call is an error even if the search already ran (e.g. found, then 409 on save).
        outcome: status >= 400 ? 'error' : (ctx.log.outcome ?? null),
        httpStatus: status,
        errorId,
        requestBody: ctx.bodyText ? ctx.bodyText.slice(0, MAX_LOGGED_BODY) : null,
        // A look-up answer embeds an earlier call's answer: storing it again would
        // restart that person data's 90-day clock (review 2026-10-17).
        responseBody: endpoint === 'requests' ? null : JSON.stringify(body).slice(0, MAX_LOGGED_BODY),
        // The refusal's code, kept after the 90-day body purge (filters and support).
        errorCode: status >= 400 ? ((body.error as { code?: string } | undefined)?.code ?? null) : null,
        // A claimed call refused with a 4xx saved nothing: it must not hold the externalId.
        ...(ctx.rowClaimed && status >= 400 && status < 500 ? { idempotencyKey: null } : {}),
        profileIds: ctx.log.profileIds?.length ? JSON.stringify(ctx.log.profileIds) : null,
        recordId: ctx.log.recordId ?? null,
        profileCreated: ctx.log.profileCreated ? 1 : 0,
        externalId: ctx.log.externalId ?? null,
        dryRun: ctx.dryRun ? 1 : 0,
        contactsAdded: ctx.log.contactsAdded?.length ? JSON.stringify(ctx.log.contactsAdded) : null,
        durationMs: Date.now() - startedAt,
    };
    try {
        if (ctx.rowClaimed) {
            await ctx.db.update(apiRequests).set(values).where(eq(apiRequests.id, ctx.requestId));
        } else {
            await ctx.db.insert(apiRequests).values({ id: ctx.requestId, idempotencyKey: null, createdAt: new Date(), ...values });
        }
    } catch (e) {
        // The client still gets its answer; the missing row is an alert, since
        // a record without its row can't be voided by its key.
        logger.error('api: transaction log write failed', e, { requestId: ctx.requestId, keyId: ctx.key.id, endpoint, status, recordId: values.recordId });
    }
}

export async function handleApiCall(
    request: Request,
    endpoint: ApiEndpoint,
    run: (ctx: ApiCallContext) => Promise<ApiResult>,
    opts: { binaryBodyMax?: number } = {},
): Promise<Response> {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();

    const origin = new URL(request.url).origin;
    if (!(await getFeatureFlag('ENABLE_PUBLIC_API'))) {
        return json(404, errorBody(requestId, origin, 'api_disabled', 'the BuenAdoptante API is not enabled'), requestId);
    }
    const db = await getDb();
    if (!db) {
        const errorId = logger.error('api: database unavailable', null, { requestId, endpoint });
        return json(500, errorBody(requestId, origin, 'server_error', 'database unavailable', errorId), requestId);
    }
    const header = request.headers.get('authorization');
    const secret = bearerSecret(header);
    const found = secret ? await findActiveKey(db, secret) : null;
    if (!found) {
        logger.info('api: unauthorized', { requestId, endpoint, hadHeader: !!header });
        return json(401, errorBody(requestId, origin, 'unauthorized', unauthorizedMessage(header, secret, new URL(request.url).host)), requestId,
            { 'WWW-Authenticate': 'Bearer' });
    }
    let access: KeyAccess;
    try {
        access = await keyAccess(db, found);
    } catch (e) {
        // Fail closed, but as a proper API answer: never let a call through we could not check.
        const errorId = logger.error('api: access check failed', e, { requestId, endpoint, keyId: found.id });
        return json(503, errorBody(requestId, origin, 'temporarily_unavailable', 'we could not check this key right now; retry in a minute', errorId), requestId, { 'Retry-After': '60' });
    }
    if (access.refusal) {
        logger.info('api: key refused by access status', { requestId, endpoint, keyId: found.id, refusal: access.refusal });
        return json(403, errorBody(requestId, origin, access.refusal, 'this key\'s owner is blocked from the API; write to us if you think this is a mistake'), requestId);
    }
    // Before approval a self-created key works with the pending limits: every cap below
    // (key, person, call ceiling, /me, RateLimit headers) reads the lowered values.
    const key = access.limited ? withPendingCaps(found) : found;

    let bodyText = '';
    let bodyBytes: ArrayBuffer | null = null;
    const maxBody = opts.binaryBodyMax ?? MAX_REQUEST_BODY;
    let tooLarge = Number(request.headers.get('content-length') || 0) > maxBody;
    if (request.method !== 'GET' && !tooLarge) {
        try {
            const read = await readBodyLimited(request, maxBody);
            if (read === null) tooLarge = true;
            else if (opts.binaryBodyMax) { bodyBytes = read.buffer as ArrayBuffer; bodyText = ''; }
            else bodyText = new TextDecoder().decode(read);
        } catch (e) {
            logger.warn('api: request body unreadable', { requestId, keyId: key.id, error: e instanceof Error ? e.message : String(e) });
        }
    }
    const ctx: ApiCallContext = {
        db, key, scopes: scopesOf(key), requestId,
        origin,
        bodyText,
        bodyBytes,
        idempotencyKey: null,
        log: {},
        rowClaimed: false,
        dryRun: false,
        limited: access.limited,
        query: new URL(request.url).searchParams,
    };

    let status: number;
    let body: Record<string, unknown>;
    let headers: Record<string, string> = {};
    let errorId: string | null = null;
    try {
        if (tooLarge) throw new ApiError(413, 'payload_too_large', `request bodies are limited to ${maxBody} bytes`);
        await enforceCallCeiling(db, key);
        if (wantsDryRun(request.headers.get(DRY_RUN_HEADER))) {
            if (endpoint === 'void') throw new ApiError(422, 'dry_run_not_allowed', 'a void cannot be a dry run');
            if (!dryRunAllowed(key.environment, new URL(request.url).host)) {
                throw new ApiError(403, 'dry_run_not_allowed', 'dry runs only work on staging, with a ba_test_ key; in production every call is saved');
            }
            ctx.dryRun = true;
            headers = { 'x-dry-run': '1' };
        }
        const result = await run(ctx);
        status = result.status;
        // This call's requestId wins over a replayed answer's (that one is in originalRequestId).
        body = { ...result.body, requestId };
    } catch (e) {
        if (e instanceof ApiError) {
            status = e.status;
            body = errorBody(requestId, origin, e.code, e.message, undefined, e.extra);
            headers = { ...headers, ...e.headers };
        } else {
            errorId = logger.error('api: request failed', e, { requestId, keyId: key.id, owner: key.ownerEmail, endpoint, mode: ctx.log.mode, context: ctx.log.context });
            status = 500;
            body = errorBody(requestId, origin, 'server_error', 'unexpected error', errorId);
        }
    }

    await writeLog(ctx, endpoint, status, body, errorId, startedAt);
    // The search quota on every search answer (IETF RateLimit fields): what is left today, and when it resets.
    if (endpoint === 'search' && ctx.log.mode && !(importModeOn(key) && ctx.log.mode === 'exact')) {
        try {
            const mode = ctx.log.mode as 'exact' | 'fuzzy';
            const keyCap = mode === 'exact' ? key.dailyCapExact : key.dailyCapFuzzy;
            // Counted when it ran (not refused, not a replay) — the same rule as searchesToday.
            const counted = status < 400 && ctx.log.outcome !== 'replayed';
            const { limit, remaining } = ctx.caps?.mode === mode ? remainingFrom(ctx.caps, keyCap, counted) : await remainingToday(db, key, mode, access.limited);
            headers = { ...headers, 'RateLimit-Limit': String(limit), 'RateLimit-Remaining': String(remaining), 'RateLimit-Reset': String(secondsToUtcMidnight()) };
        } catch (e) {
            logger.warn('api: rate-limit headers skipped', { requestId, keyId: key.id, error: e instanceof Error ? e.message : String(e) });
        }
    }
    logger.info('api: call', { requestId, keyId: key.id, endpoint, mode: ctx.log.mode, outcome: ctx.log.outcome, status, errorId, durationMs: Date.now() - startedAt });

    await runAfterResponse('api.touchKey', async () => {
        await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id));
        // Cheap and indexed; run on ~1 call in 50 so old person data doesn't
        // depend on anyone opening an admin page.
        if (Math.random() < 0.02) await purgeOldRequestBodies(db);
    }, { requestId, keyId: key.id });

    return json(status, body, requestId, headers);
}

/**
 * Why a key was refused, as precisely as is safe. The prefix of a key is not
 * secret, so "a test key in production" can be said; an unknown key and a
 * revoked one stay the same answer.
 */
export function unauthorizedMessage(header: string | null, secret: string | null, host: string): string {
    if (!header) return 'no API key: send the header Authorization: Bearer ba_live_… (production) or ba_test_… (staging)';
    if (!secret) return 'malformed Authorization header: it must be exactly "Bearer <your key>"';
    const live = environmentForHost(host) === 'live';
    if (live && secret.startsWith('ba_test_')) return 'this is a test key (ba_test_…): it only works on staging; use your ba_live_ key here';
    if (!live && secret.startsWith('ba_live_')) return 'this is a production key (ba_live_…): staging needs a ba_test_ key';
    return 'unknown or revoked API key';
}

/** The body's bytes, or null as soon as it passes `max` bytes (a chunked upload has no length to check up front). */
async function readBodyLimited(request: Request, max: number): Promise<Uint8Array | null> {
    if (!request.body) return new Uint8Array(0);
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > max) { await reader.cancel(); return null; }
        chunks.push(value);
    }
    const all = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) { all.set(c, at); at += c.byteLength; }
    return all;
}

/** Drop the person data (request and response bodies) from log rows older than the retention window. */
export async function purgeOldRequestBodies(db: Db): Promise<void> {
    const cutoff = new Date(Date.now() - REQUEST_BODY_RETENTION_DAYS * 86_400_000);
    // The response can carry names as the rescuer saw them (fuzzy results), so it goes too.
    await db.update(apiRequests).set({ requestBody: null, responseBody: null })
        .where(and(lt(apiRequests.createdAt, cutoff), isNotNull(apiRequests.requestBody)));
}
