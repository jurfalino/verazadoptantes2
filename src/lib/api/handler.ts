/**
 * One wrapper for every /api/v1 endpoint: feature flag, key, error shape,
 * transaction log, daily caps and idempotent replay. Server-only.
 *
 * Every call made with a valid key leaves exactly one `api_requests` row: that
 * row is what the admin page and the rescuer's own log review, what a key's
 * daily cap counts, and what a void checks ("did this key create the record?").
 */
import { NextResponse } from 'next/server';
import { and, eq, gte, ne, count, lt, isNotNull } from 'drizzle-orm';
import { apiKeys, apiRequests } from '@/db/schema';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { runAfterResponse } from '@/lib/background';
import { getFeatureFlag } from '@/config/features';
import { isAdminAsyncStrict } from '@/config/admins';
import { bearerSecret, findActiveKey, scopesOf, type ApiKeyRow } from './keys';
import type { ApiErrorCode, ApiScope } from './schemas';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

export type ApiEndpoint = 'search' | 'me' | 'void' | 'contract';

/**
 * Read-only test calls: `X-Dry-Run: 1` runs a search end to end — validation,
 * scopes, Idempotency-Key, caps, the found / not_found / ambiguous decision —
 * but writes no record, profile or notification. Deliberately left out of the
 * docs, and honoured only for keys owned by an admin: every rescue's exact
 * search must leave a record. Any other key sending it is refused (403), never
 * silently saved, since its developer believes nothing is being written.
 */
export const DRY_RUN_HEADER = 'x-dry-run';
export function wantsDryRun(value: string | null): boolean {
    return value != null && /^(1|true|yes)$/i.test(value.trim());
}

/** Person data the client sent is kept this long, then dropped from the log. */
export const REQUEST_BODY_RETENTION_DAYS = 90;
/** Whole request kept for review (an adoption form's answers included), then purged as above. */
const MAX_LOGGED_BODY = 64_000;
/** A call is a few hundred bytes, plus up to 50 KB of form answers (FORM_CONTENT_MAX_BYTES). */
const MAX_REQUEST_BODY = 64_000;
/** A save takes seconds; a claim still open after this was abandoned by a dead worker. */
const ABANDONED_CLAIM_MS = 120_000;

export class ApiError extends Error {
    constructor(public status: number, public code: ApiErrorCode, message: string, public headers: Record<string, string> = {}) {
        super(message);
    }
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
    idempotencyKey: string | null;
    log: LogFields;
    /** Set when this call already owns a log row (idempotency claim). */
    rowClaimed: boolean;
    /** An admin's read-only test call: nothing is written but its log row. */
    dryRun: boolean;
}

export interface ApiResult { status: number; body: Record<string, unknown> }

function json(status: number, body: Record<string, unknown>, requestId: string, headers: Record<string, string> = {}) {
    return NextResponse.json(body, {
        status,
        headers: { 'x-request-id': requestId, 'cache-control': 'no-store', ...headers },
    });
}

function errorBody(requestId: string, code: string, message: string, errorId?: string) {
    return { requestId, error: { code, message, ...(errorId ? { errorId } : {}) } };
}

export function requireScope(ctx: ApiCallContext, scope: ApiScope) {
    if (!ctx.scopes.includes(scope)) throw new ApiError(403, 'forbidden', `this key lacks the ${scope} scope`);
}

/** Start of today, UTC: caps reset with the free-tier quotas, at 00:00 UTC. */
export function startOfUtcDay(now = new Date()): Date {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Searches of one mode this key made today (refused-for-cap calls don't count). */
export async function searchesToday(db: Db, keyId: string, mode: 'exact' | 'fuzzy'): Promise<number> {
    const row = await db.select({ n: count() }).from(apiRequests).where(and(
        eq(apiRequests.keyId, keyId),
        eq(apiRequests.endpoint, 'search'),
        eq(apiRequests.mode, mode),
        gte(apiRequests.createdAt, startOfUtcDay()),
        ne(apiRequests.httpStatus, 429),
    )).get();
    return row?.n ?? 0;
}

function retryAfterMidnight(): Record<string, string> {
    const now = new Date();
    return { 'Retry-After': String(Math.ceil((startOfUtcDay(now).getTime() + 86_400_000 - now.getTime()) / 1000)) };
}

/** Checked BEFORE an idempotency claim, so a refused call never becomes the stored answer. */
export async function enforceDailyCap(ctx: ApiCallContext, mode: 'exact' | 'fuzzy') {
    const cap = mode === 'exact' ? ctx.key.dailyCapExact : ctx.key.dailyCapFuzzy;
    if (await searchesToday(ctx.db, ctx.key.id, mode) >= cap) {
        throw new ApiError(429, 'daily_cap_reached', `daily ${mode} cap of ${cap} reached; resets at 00:00 UTC`, retryAfterMidnight());
    }
}

/**
 * A ceiling on EVERY call a key makes in a day (bad JSON, /me, refused calls
 * included): each one is a request against the account-wide free quota and a
 * log row, so a client stuck in a loop must stop long before the site does.
 */
export const DAILY_CALL_CEILING_FLOOR = 1000;
async function enforceCallCeiling(db: Db, key: ApiKeyRow) {
    const ceiling = Math.max(DAILY_CALL_CEILING_FLOOR, 2 * (key.dailyCapExact + key.dailyCapFuzzy));
    const row = await db.select({ n: count() }).from(apiRequests)
        .where(and(eq(apiRequests.keyId, key.id), gte(apiRequests.createdAt, startOfUtcDay()))).get();
    if ((row?.n ?? 0) >= ceiling) {
        throw new ApiError(429, 'daily_cap_reached', `daily ceiling of ${ceiling} calls reached; resets at 00:00 UTC`, retryAfterMidnight());
    }
}

type ApiRequestRow = typeof apiRequests.$inferSelect;

/**
 * Idempotent saves, step 1 (read-only): what does an earlier call with this
 * key say? A retry with the same body gets the stored answer; a different body
 * is refused. An earlier call that crashed (5xx) before writing anything is
 * released so the retry runs again; one that crashed AFTER creating a profile
 * or record is not (a rerun would duplicate it); the log shows what exists.
 */
export async function replayIdempotent(ctx: ApiCallContext): Promise<ApiResult | null> {
    if (!ctx.idempotencyKey) return null;
    const where = and(eq(apiRequests.keyId, ctx.key.id), eq(apiRequests.idempotencyKey, ctx.idempotencyKey));
    const prior = await ctx.db.select().from(apiRequests).where(where).get() as ApiRequestRow | undefined;
    if (!prior) return null;
    const partial = !!prior.recordId || prior.profileCreated === 1;
    // A claim nobody finished (the worker died mid-call) counts as a crash.
    const abandoned = prior.httpStatus === 0 && Date.now() - new Date(prior.createdAt).getTime() > ABANDONED_CLAIM_MS;
    if ((prior.httpStatus >= 500 || abandoned) && !partial) {
        await ctx.db.delete(apiRequests).where(eq(apiRequests.id, prior.id));
        return null;
    }
    if (prior.httpStatus >= 500 || abandoned) {
        throw new ApiError(409, 'idempotency_key_reused', `an earlier attempt with this Idempotency-Key (request ${prior.id}) stopped after saving part of the data; it is listed under Settings → API, where it can be voided before you retry with a new key`);
    }
    if (prior.httpStatus === 0) {
        throw new ApiError(409, 'idempotency_key_reused', 'a request with this Idempotency-Key is still being processed');
    }
    if (prior.requestBody === null) {
        throw new ApiError(409, 'idempotency_key_reused', 'this Idempotency-Key is too old to replay; use a new one');
    }
    if (prior.requestBody !== ctx.bodyText.slice(0, MAX_LOGGED_BODY)) {
        throw new ApiError(409, 'idempotency_key_reused', 'this Idempotency-Key was already used with a different request body');
    }
    logger.info('api: idempotent replay', { requestId: ctx.requestId, originalRequestId: prior.id, keyId: ctx.key.id });
    const body = prior.responseBody ? JSON.parse(prior.responseBody) : {};
    return { status: prior.httpStatus, body: { ...body, replayed: true } };
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
        throw new ApiError(409, 'idempotency_key_reused', 'a request with this Idempotency-Key is still being processed');
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
        responseBody: JSON.stringify(body).slice(0, MAX_LOGGED_BODY),
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

    if (!(await getFeatureFlag('ENABLE_PUBLIC_API'))) {
        return json(404, errorBody(requestId, 'api_disabled', 'the BuenAdoptante API is not enabled'), requestId);
    }
    const db = await getDb();
    if (!db) {
        const errorId = logger.error('api: database unavailable', null, { requestId, endpoint });
        return json(500, errorBody(requestId, 'server_error', 'database unavailable', errorId), requestId);
    }
    const secret = bearerSecret(request.headers.get('authorization'));
    const key = secret ? await findActiveKey(db, secret) : null;
    if (!key) {
        logger.info('api: unauthorized', { requestId, endpoint, hadHeader: !!request.headers.get('authorization') });
        return json(401, errorBody(requestId, 'unauthorized', 'missing, malformed, unknown or revoked API key'), requestId,
            { 'WWW-Authenticate': 'Bearer' });
    }

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
        origin: new URL(request.url).origin,
        bodyText,
        bodyBytes,
        idempotencyKey: request.headers.get('idempotency-key')?.trim().slice(0, 200) || null,
        log: {},
        rowClaimed: false,
        dryRun: false,
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
            if (!(await isAdminAsyncStrict(key.ownerEmail))) throw new ApiError(403, 'dry_run_not_allowed', 'this key cannot make dry runs');
            ctx.dryRun = true;
            headers = { 'x-dry-run': '1' };
        }
        const result = await run(ctx);
        status = result.status;
        body = { requestId, ...result.body };
    } catch (e) {
        if (e instanceof ApiError) {
            status = e.status;
            body = errorBody(requestId, e.code, e.message);
            headers = { ...headers, ...e.headers };
        } else {
            errorId = logger.error('api: request failed', e, { requestId, keyId: key.id, owner: key.ownerEmail, endpoint, mode: ctx.log.mode, context: ctx.log.context });
            status = 500;
            body = errorBody(requestId, 'server_error', 'unexpected error', errorId);
        }
    }

    await writeLog(ctx, endpoint, status, body, errorId, startedAt);
    logger.info('api: call', { requestId, keyId: key.id, endpoint, mode: ctx.log.mode, outcome: ctx.log.outcome, status, errorId, durationMs: Date.now() - startedAt });

    await runAfterResponse('api.touchKey', async () => {
        await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id));
        // Cheap and indexed; run on ~1 call in 50 so old person data doesn't
        // depend on anyone opening an admin page.
        if (Math.random() < 0.02) await purgeOldRequestBodies(db);
    }, { requestId, keyId: key.id });

    return json(status, body, requestId, headers);
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
