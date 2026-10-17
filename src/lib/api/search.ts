/**
 * POST /api/v1/search: exact and fuzzy modes (.agents/plans/2026-10-09-third-party-api.md).
 * Server-only; the route file is a thin wrapper around `runSearch`.
 */
import { decideExactOutcome } from '@/domain/apiExactMatch';
import { SEARCH_RESULT_LIMIT } from '@/config/constants';
import { logger } from '@/lib/logger';
import type { DiscoveryMatch } from '@/app/actions/types';
import { ApiError, claimIdempotencyKey, enforceDailyCap, replayIdempotent, requireScope, type ApiCallContext, type ApiResult } from './handler';
import { buildProfileSummaries, findIdentifierHits, ownerCountry, profileUrl, ratingFields, registeredByRescue } from './profiles';
import { saveApiActivity } from './records';
import { checkSearchRules, searchRequestSchema, type ApiRisk, type ExactResponse, type FuzzyResponse, type ProfileSummary, type SearchRequest } from './schemas';

/** The lowest rating among rated profiles; "not rated" only if none is. */
function worstOf(ratings: Array<number | null | undefined>) {
    const rated = ratings.filter((r): r is number => typeof r === 'number');
    return ratingFields(rated.length ? Math.min(...rated) : null);
}

/** Negative signals only: verified_* flags are reassurance, not risk. */
const NOT_RISK = new Set(['verified_identity', 'verified_address']);

/** The worst signal across every profile the identifiers matched (never just the chosen one). */
export function riskOf(summaries: Array<ProfileSummary | undefined>): ApiRisk {
    const present = summaries.filter((s): s is ProfileSummary => !!s);
    const flags = new Set<string>();
    const alerts: ApiRisk['alerts'] = [];
    for (const s of present) {
        for (const f of s.flags) if (!NOT_RISK.has(f)) flags.add(f);
        for (const a of s.alerts) alerts.push({ ...a, profileId: s.profileId });
    }
    return { worstRating: worstOf(present.map(s => s.rating)), flags: [...flags].sort(), alerts, profilesMatched: present.length };
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
    ctx.log.context = req.activity?.activityType ?? null;
    ctx.log.externalId = req.activity?.externalId ?? null;

    const broken = checkSearchRules(req);
    if (broken) throw new ApiError(422, broken.code, broken.message);

    requireScope(ctx, req.mode === 'exact' ? 'search' : 'search:fuzzy');
    // An exact call saves its activity (Jon, 2026-10-13); without one it is a
    // look-up, answered only for people this rescue already registered (runExact).
    // A dry run (admin-owned keys only, see handler) checks all the same things
    // but writes nothing, so it neither replays nor claims the Idempotency-Key.
    const saves = req.mode === 'exact' && !!req.activity;
    if (saves) {
        requireScope(ctx, 'record:write');
        if (!ctx.idempotencyKey) throw new ApiError(422, 'idempotency_key_required', 'an exact call that saves an activity needs an Idempotency-Key header');
        if (!ctx.dryRun) {
            const replay = await replayIdempotent(ctx);
            if (replay) {
                ctx.log.outcome = 'replayed';
                return replay;
            }
        }
    }
    // Cap before claiming: a refused call must never become the stored answer.
    await enforceDailyCap(ctx, req.mode);
    if (saves && !ctx.dryRun) await claimIdempotencyKey(ctx);

    return req.mode === 'exact' ? runExact(ctx, req) : runFuzzy(ctx, req);
}

async function runExact(ctx: ApiCallContext, req: SearchRequest): Promise<ApiResult> {
    const country = req.person.phone ? await ownerCountry(ctx.db, ctx.key.ownerEmail, ctx.requestId) : null;
    const hits = await findIdentifierHits(ctx.db, req.person, ctx.requestId, country);
    let outcome = decideExactOutcome(req.person.fullName!, hits.candidates);
    let ids = outcome.result === 'found' ? [outcome.profileId, ...outcome.otherProfileIds] : outcome.result === 'ambiguous' ? outcome.profileIds : [];

    if (!req.activity) {
        // A look-up leaves no activity, so it is only for people this rescue
        // already registered (Jon, 2026-10-13), and it shows ONLY those
        // profiles: never a stranger who shares the phone or email. Checked
        // before anything else is read or logged; everyone else — including
        // nobody — gets the same refusal, with nothing recorded about who matched.
        const mine = await registeredByRescue(ctx.db, ids, ctx.key.ownerEmail, ctx.requestId);
        const answerable = outcome.result === 'found' ? mine.has(outcome.profileId) : mine.size > 0;
        if (!answerable) throw new ApiError(422, 'activity_required', 'send an activity: an exact call without one is only answered for people your rescue already registered');
        ids = ids.filter(id => mine.has(id));
        if (outcome.result === 'found') outcome = { ...outcome, otherProfileIds: outcome.otherProfileIds.filter(id => mine.has(id)) };
        else if (outcome.result === 'ambiguous') outcome = { ...outcome, profileIds: outcome.profileIds.filter(id => mine.has(id)) };
    }
    ctx.log.outcome = outcome.result;

    // Describe the person as they stood BEFORE this call: a rescue's own
    // just-saved request must not flag the person as "asking too often".
    const summaries = await buildProfileSummaries(ctx.db, ids, ctx.origin, ctx.requestId);

    const body: Omit<ExactResponse, 'requestId'> = { mode: 'exact', result: outcome.result, risk: riskOf([]) };
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
    body.risk = riskOf(ids.map(id => summaries.get(id)));
    ctx.log.profileIds = ids;

    if (!req.activity) return { status: 200, body };
    if (!ctx.dryRun) {
        body.activity = await saveApiActivity(ctx, req, outcome, hits.matchedOn, summaries);
        ctx.log.profileIds = [body.activity.profileId, ...ids.filter(id => id !== body.activity!.profileId)];
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
