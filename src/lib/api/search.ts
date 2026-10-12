/**
 * POST /api/v1/search: exact and fuzzy modes (.agents/plans/2026-10-09-third-party-api.md).
 * Server-only; the route file is a thin wrapper around `runSearch`.
 */
import { decideExactOutcome } from '@/domain/apiExactMatch';
import { SEARCH_RESULT_LIMIT } from '@/config/constants';
import { logger } from '@/lib/logger';
import type { DiscoveryMatch } from '@/app/actions/types';
import { ApiError, claimIdempotencyKey, enforceDailyCap, replayIdempotent, requireScope, type ApiCallContext, type ApiResult } from './handler';
import { buildProfileSummaries, findIdentifierHits, ownerCountry, profileUrl, ratingFields } from './profiles';
import { saveApiRecord } from './records';
import { checkSearchRules, searchRequestSchema, type ExactResponse, type FuzzyResponse, type SearchRequest } from './schemas';

/** The lowest rating among rated profiles; "not rated" only if none is. */
function worstOf(ratings: Array<number | null | undefined>) {
    const rated = ratings.filter((r): r is number => typeof r === 'number');
    return ratingFields(rated.length ? Math.min(...rated) : null);
}

function parseRequest(ctx: ApiCallContext): SearchRequest {
    let raw: unknown;
    try { raw = JSON.parse(ctx.bodyText); } catch {
        throw new ApiError(400, 'invalid_json', 'the request body is not valid JSON');
    }
    const parsed = searchRequestSchema.safeParse(raw);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new ApiError(422, 'invalid_request', `${issue.path.join('.') || 'body'}: ${issue.message}`);
    }
    return parsed.data;
}

export async function runSearch(ctx: ApiCallContext): Promise<ApiResult> {
    const req = parseRequest(ctx);
    ctx.log.mode = req.mode;
    ctx.log.context = req.context;
    ctx.log.externalId = req.save?.externalId ?? null;

    const broken = checkSearchRules(req);
    if (broken) throw new ApiError(422, broken.code, broken.message);

    requireScope(ctx, req.mode === 'exact' ? 'search' : 'search:fuzzy');
    if (req.save) {
        requireScope(ctx, 'record:write');
        if (!ctx.idempotencyKey) throw new ApiError(422, 'idempotency_key_required', 'saving a record needs an Idempotency-Key header');
        const replay = await replayIdempotent(ctx);
        if (replay) {
            ctx.log.outcome = 'replayed';
            return replay;
        }
    }
    // Cap before claiming: a refused call must never become the stored answer.
    await enforceDailyCap(ctx, req.mode);
    if (req.save) await claimIdempotencyKey(ctx);

    return req.mode === 'exact' ? runExact(ctx, req) : runFuzzy(ctx, req);
}

async function runExact(ctx: ApiCallContext, req: SearchRequest): Promise<ApiResult> {
    const country = req.person.phone ? await ownerCountry(ctx.db, ctx.key.ownerEmail, ctx.requestId) : null;
    const hits = await findIdentifierHits(ctx.db, req.person, ctx.requestId, country);
    const outcome = decideExactOutcome(req.person.fullName!, hits.candidates);
    ctx.log.outcome = outcome.result;

    // Describe the person as they stood BEFORE this call: a rescue's own
    // just-saved request must not flag the person as "asking too often".
    const ids = outcome.result === 'found' ? [outcome.profileId, ...outcome.otherProfileIds] : outcome.result === 'ambiguous' ? outcome.profileIds : [];
    const summaries = await buildProfileSummaries(ctx.db, ids, ctx.origin, ctx.requestId);

    const body: Omit<ExactResponse, 'requestId'> = { mode: 'exact', result: outcome.result };
    if (outcome.result === 'found') {
        const summary = summaries.get(outcome.profileId);
        if (!summary) throw new Error(`profile summary missing for ${outcome.profileId}`);
        body.profile = { ...summary, matchedOn: hits.matchedOn.get(outcome.profileId) ?? [], nameMatchedAs: outcome.nameMatchedAs };
        if (outcome.otherProfileIds.length) {
            body.otherMatches = {
                count: outcome.otherProfileIds.length,
                urls: outcome.otherProfileIds.map(id => profileUrl(ctx.origin, id)),
                worstRating: worstOf(outcome.otherProfileIds.map(id => summaries.get(id)?.rating)),
            };
        }
    } else if (outcome.result === 'ambiguous') {
        body.reason = outcome.reason;
        body.candidates = outcome.profileIds.length;
        body.candidateUrls = outcome.profileIds.map(id => profileUrl(ctx.origin, id));
        body.worstRating = worstOf(outcome.profileIds.map(id => summaries.get(id)?.rating));
    }
    ctx.log.profileIds = ids;

    if (req.save) {
        body.saved = await saveApiRecord(ctx, req, outcome);
        ctx.log.profileIds = [body.saved.profileId, ...ids.filter(id => id !== body.saved!.profileId)];
    }
    return { status: 200, body };
}

/** The person fields as one homepage-style query, in the order a person would type them. */
export function fuzzyQueryOf(person: SearchRequest['person']): string {
    return [
        person.fullName, person.email, person.phone, person.documentId?.value, person.address,
        ...(person.socials ?? []).map(s => s.handle),
    ].filter((v): v is string => !!v && !!v.trim()).join(' ');
}

async function runFuzzy(ctx: ApiCallContext, req: SearchRequest): Promise<ApiResult> {
    const { findAdoptersAsViewer } = await import('@/app/actions/findAdopters');
    const res = await findAdoptersAsViewer({ raw: fuzzyQueryOf(req.person) }, { enrich: true }, ctx.key.ownerEmail);
    if (res.validationError) {
        logger.info('api: fuzzy query refused by the search engine', { requestId: ctx.requestId, validationError: res.validationError });
        throw new ApiError(422, 'invalid_request', `the search engine refused this query (${res.validationError})`);
    }
    // The homepage shows full-coverage matches first and partial ones below; the API keeps that order.
    const matches = [...(res.results as DiscoveryMatch[]), ...((res.lowRelevanceResults ?? []) as DiscoveryMatch[])]
        .slice(0, SEARCH_RESULT_LIMIT);
    const ids = matches.map(m => m.adopterId);
    const summaries = await buildProfileSummaries(ctx.db, ids, ctx.origin, ctx.requestId);

    ctx.log.outcome = 'results';
    ctx.log.profileIds = ids;
    const body: Omit<FuzzyResponse, 'requestId'> = {
        mode: 'fuzzy',
        results: matches.flatMap(m => {
            const profile = summaries.get(m.adopterId);
            return profile ? [{ relevancePercent: Math.round(m.relevancePercent), name: m.adopter?.name ?? m.adopterName, profile }] : [];
        }),
        ...(res.truncated ? { truncated: true } : {}),
    };
    return { status: 200, body };
}
