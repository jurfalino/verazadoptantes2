/**
 * POST /api/v1/search: exact and fuzzy modes (.agents/plans/2026-10-09-third-party-api.md).
 * Server-only; the route file is a thin wrapper around `runSearch`.
 */
import { decideExactOutcome } from '@/domain/apiExactMatch';
import { cleanApiPerson } from '@/domain/apiPersonCleanup';
import { SEARCH_RESULT_LIMIT } from '@/config/constants';
import { logger } from '@/lib/logger';
import type { DiscoveryMatch } from '@/app/actions/types';
import { ApiError, claimIdempotencyKey, enforceDailyCap, replayIdempotent, requireScope, type ApiCallContext, type ApiResult } from './handler';
import { buildProfileSummaries, findIdentifierHits, ownerCountry, profileUrl, ratingFields } from './profiles';
import { bestMatchFor, saveApiActivity } from './records';
import { environmentForHost, importModeOn } from './keys';
import { isExampleData } from './docScenarios';
import { checkSearchRules, searchRequestSchema, type ApiRisk, type ExactResponse, type FuzzyResponse, orderCandidates, saveActionOf, type ProfileSummary, type SearchRequest, type ApiWarning } from './schemas';

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
    const flags = new Set<ApiRisk['flags'][number]>();
    const alerts: ApiRisk['alerts'] = [];
    for (const s of present) {
        for (const f of s.flags) if (!NOT_RISK.has(f)) flags.add(f as ApiRisk['flags'][number]);
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
        // Every problem at once, each with its field: one round trip to fix a form, not one per field.
        const details = parsed.error.issues.map(i => ({ code: 'invalid_request', field: i.path.join('.') || 'body', message: i.message }));
        throw new ApiError(422, 'invalid_request', `${details[0].field}: ${details[0].message}`, {}, { field: details[0].field, details });
    }
    return parsed.data;
}

export async function runSearch(ctx: ApiCallContext): Promise<ApiResult> {
    const req = parseRequest(ctx);
    ctx.log.mode = req.mode;
    ctx.log.context = req.activity?.activityType ?? null;
    ctx.log.externalId = req.activity?.externalId ?? null;

    // Unusable parts are left out (and said so) before the rules run: one bad
    // field no longer refuses a call that has another usable identifier.
    const cleanup = cleanApiPerson(req.person);
    req.person = cleanup.person;
    const warnings: ApiWarning[] = [
        ...cleanup.dropped.map(d => ({ field: d.field, code: 'value_dropped' as const, reason: d.reason, message: `${d.field} was not saved: ${d.reason === 'not_an_email' ? 'it is not an email address' : d.reason === 'not_a_phone' ? 'it is not a readable phone number' : d.reason === 'not_a_social_profile' ? 'it is a website, not a social network profile' : 'it says the person has no account'}` })),
        ...cleanup.cleaned.map(c => ({ field: c.field, code: 'value_cleaned' as const, reason: c.reason, message: `${c.field}: ${c.reason === 'first_valid_email' ? 'only the first valid email was kept' : 'only the phone number(s) were kept'}` })),
    ];

    const problems = checkSearchRules(req);
    if (problems.length) {
        const [first] = problems;
        throw new ApiError(422, first.code, first.message, {}, { field: first.field, details: problems });
    }
    // The docs' example people exist on staging only: in production they would
    // become real profiles, so a pasted example is refused there.
    if (environmentForHost(new URL(ctx.origin).host) === 'live' && isExampleData(req.person)) {
        throw new ApiError(422, 'example_data', 'these are the documentation\'s example data; in production send a real person (to try the examples, use staging with a ba_test_ key)', {}, { field: 'person' });
    }

    requireScope(ctx, req.mode === 'exact' ? 'search' : 'search:fuzzy');
    // An exact call always saves its activity (Jon, 2026-10-13/17; a look-up is
    // fuzzy). Its externalId is what makes a resend a retry, not a second
    // activity. A dry run checks the same things but writes nothing, so it
    // neither replays nor claims.
    const saves = req.mode === 'exact';
    if (saves) {
        requireScope(ctx, 'record:write');
        ctx.idempotencyKey = `ext:${req.activity!.externalId!}`;
        // A dry run checks it too (read-only): it must answer what the real call
        // would — a replay, or a 409 for an externalId already used.
        const replay = await replayIdempotent(ctx, { readOnly: ctx.dryRun });
        if (replay) {
            ctx.log.outcome = 'replayed';
            return replay;
        }
    }
    // Cap before claiming: a refused call must never become the stored answer.
    // An import-mode key's exact calls are our own bulk import (its script keeps the budget);
    // fuzzy keeps its cap — import mode must never open unlimited look-ups.
    if (!(importModeOn(ctx.key) && req.mode === 'exact')) await enforceDailyCap(ctx, req.mode);
    if (saves && !ctx.dryRun) await claimIdempotencyKey(ctx);

    const result = req.mode === 'exact' ? await runExact(ctx, req) : await runFuzzy(ctx, req);
    if (warnings.length && result.status < 300) (result.body as { warnings?: ApiWarning[] }).warnings = warnings;
    return result;
}

async function runExact(ctx: ApiCallContext, req: SearchRequest): Promise<ApiResult> {
    let hits: Awaited<ReturnType<typeof findIdentifierHits>>;
    try {
        // The rescuer's country decides how a phone is read: a failed read must not guess.
        const country = req.person.phone ? await ownerCountry(ctx.db, ctx.key.ownerEmail, ctx.requestId) : null;
        hits = await findIdentifierHits(ctx.db, req.person, ctx.requestId, country);
    } catch (e) {
        if (e instanceof ApiError) throw e;
        logger.error('api: identifier lookup failed', e, { requestId: ctx.requestId, keyId: ctx.key.id });
        throw new ApiError(503, 'temporarily_unavailable', 'could not search for the person right now; nothing was saved — retry in a moment', { 'Retry-After': '5' });
    }
    const outcome = decideExactOutcome(req.person.fullName!, hits.candidates);
    const ids = outcome.result === 'found' ? [outcome.profileId, ...outcome.otherProfileIds] : outcome.result === 'ambiguous' ? outcome.profileIds : [];
    ctx.log.outcome = outcome.result;

    // Describe the person as they stood BEFORE this call: a rescue's own
    // just-saved request must not flag the person as "asking too often".
    // Fails closed (503) if the ratings can't be read.
    const summaries = await buildProfileSummaries(ctx.db, ids, ctx.origin, ctx.requestId, ctx.key.ownerEmail);

    const body: Omit<ExactResponse, 'requestId'> = { mode: 'exact', match: outcome.result, risk: riskOf([]), saved: { action: 'nothing_saved' } };
    const matched = (id: string) => hits.matchedOn.get(id)?.length ?? 0;
    if (outcome.result === 'found') {
        const summary = summaries.get(outcome.profileId);
        if (!summary) throw new Error(`profile summary missing for ${outcome.profileId}`);
        body.profile = { ...summary, matchedOn: hits.matchedOn.get(outcome.profileId) ?? [], nameMatchedAs: outcome.nameMatchedAs };
        if (outcome.otherProfileIds.length) {
            body.otherMatches = orderCandidates(outcome.otherProfileIds.map(id => ({ profileId: id, url: profileUrl(ctx.origin, id) })), matched);
        }
    } else if (outcome.result === 'ambiguous') {
        const fits = new Map(outcome.compatible.map(c => [c.profileId, c.as]));
        body.reason = outcome.reason;
        body.candidates = orderCandidates(outcome.profileIds.map(id => ({ profileId: id, url: profileUrl(ctx.origin, id), nameMatchedAs: fits.get(id) ?? null })), matched);
    }
    body.risk = riskOf(ids.map(id => summaries.get(id)));
    ctx.log.profileIds = ids;

    if (ctx.dryRun) {
        // What it WOULD do — the thing a partner tests for — with no ids.
        const best = bestMatchFor(outcome, hits.matchedOn, summaries);
        body.saved = { action: saveActionOf(outcome.result, outcome.result === 'ambiguous' && !best), dryRun: true };
        return { status: 200, body };
    }
    const s = await saveApiActivity(ctx, req, outcome, hits.matchedOn, summaries);
    body.saved = {
        action: saveActionOf(outcome.result, s.profileCreated),
        activityId: s.activityId, activityUrl: s.activityUrl, profileId: s.profileId, profileUrl: s.profileUrl, contactsAdded: s.contactsAdded,
    };
    ctx.log.profileIds = [s.profileId, ...ids.filter(id => id !== s.profileId)];
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
    const summaries = await buildProfileSummaries(ctx.db, ids, ctx.origin, ctx.requestId, ctx.key.ownerEmail);

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
