/**
 * GET /api/v1/requests/{requestId} and /api/v1/requests?externalId=…: what an
 * earlier call of THIS key did — for the partner whose script timed out and
 * doesn't know whether the adoption was saved (review 2026-10-17). Only the
 * key's own calls; any other id answers 404, revealing nothing.
 */
import { and, desc, eq, isNotNull, ne } from 'drizzle-orm';
import { apiRequests } from '@/db/schema';
import { ApiError, type ApiCallContext, type ApiResult } from './handler';
import type { PastCallResponse } from './schemas';

type Row = typeof apiRequests.$inferSelect;

function iso(v: unknown): string | null {
    const t = v instanceof Date ? v.getTime() : typeof v === 'number' ? v * 1000 : null;
    return t === null || Number.isNaN(t) ? null : new Date(t).toISOString();
}

function view(r: Row): PastCallResponse['call'] {
    let response: Record<string, unknown> | null = null;
    if (r.responseBody) {
        try { response = JSON.parse(r.responseBody); } catch { response = null; }
    }
    return {
        requestId: r.id,
        createdAt: iso(r.createdAt)!,
        endpoint: r.endpoint,
        httpStatus: r.httpStatus,
        externalId: r.externalId ?? null,
        activityId: r.recordId ?? null,
        voided: !!r.voidedAt,
        dryRun: r.dryRun === 1,
        // Dropped with the person data after 90 days (REQUEST_BODY_RETENTION_DAYS).
        response,
    };
}

export async function runPastCall(ctx: ApiCallContext, requestId: string | null): Promise<ApiResult> {
    const { db, key } = ctx;
    let row: Row | undefined;
    if (requestId) {
        // Never a look-up of a look-up: only the calls that did something.
        row = await db.select().from(apiRequests).where(and(eq(apiRequests.id, requestId), eq(apiRequests.keyId, key.id), ne(apiRequests.endpoint, 'requests'))).get();
    } else {
        const externalId = ctx.query.get('externalId')?.trim();
        if (!externalId) throw new ApiError(422, 'invalid_request', 'send a requestId in the path, or ?externalId=', {}, { field: 'externalId' });
        // The call that SAVED it (a retry or a refusal with the same id saved nothing); latest first.
        row = await db.select().from(apiRequests).where(and(
            eq(apiRequests.keyId, key.id), eq(apiRequests.endpoint, 'search'), eq(apiRequests.externalId, externalId), isNotNull(apiRequests.recordId),
        )).orderBy(desc(apiRequests.createdAt)).get();
    }
    if (!row || row.id === ctx.requestId) throw new ApiError(404, 'not_found', 'no call of this key with that id');
    ctx.log.outcome = 'looked_up';
    const body: Omit<PastCallResponse, 'requestId'> = { call: view(row) };
    return { status: 200, body };
}
