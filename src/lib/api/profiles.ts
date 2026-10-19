/**
 * Read side of the API: find the profiles an identifier hits (exact mode) and
 * describe a profile (both modes). Server-only.
 *
 * D1 note: no IN-lists (they mis-bind on D1); every lookup fans out with
 * Promise.all over single-value queries.
 */
import { and, count, eq, isNull, max, sql } from 'drizzle-orm';
import { adopters, adoptions, duplicateTokens, userProfiles, users } from '@/db/schema';
import { logger } from '@/lib/logger';
import { deserializeContactEntries } from '@/lib/contactEntries';
import { deserializeHouseholdMembers } from '@/lib/householdMembers';
import { enrichAdopters } from '@/app/actions/enrichAdopters';
import { getRatingDisplayLevel, getRatingLabelKey } from '@/domain/ratings';
import { RECORD_TYPES } from '@/domain/constants';
import { normalizeDocumentId, type CandidateNames } from '@/domain/apiExactMatch';
import { phoneDuplicateTokens } from '@/domain/phoneNumber';
import type { ProfileSummary, SearchRequest } from './schemas';
import { ApiError } from './handler';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;
export type MatchedOn = 'email' | 'phone' | 'documentId';

export interface IdentifierHits {
    candidates: CandidateNames[];
    matchedOn: Map<string, MatchedOn[]>;
}

export function profileUrl(origin: string, profileId: string): string {
    return `${origin}/adopter/${encodeURIComponent(profileId)}`;
}

export function recordUrl(origin: string, profileId: string, recordId: string): string {
    return `${profileUrl(origin, profileId)}?record=${encodeURIComponent(recordId)}`;
}

/** The key owner's country (user_profiles), which a phone is read with — as the rescuer's own search does. */
export async function ownerCountry(db: Db, ownerEmail: string, requestId: string): Promise<string | null> {
    try {
        const row = await db.select({ country: userProfiles.country })
            .from(userProfiles).innerJoin(users, eq(users.id, userProfiles.userId))
            .where(eq(users.email, ownerEmail)).get();
        return row?.country?.trim() || null;
    } catch (e) {
        // Fails closed (review 2026-10-17): guessing Argentina could miss a match
        // abroad, create a duplicate and show a clean risk. The caller answers 503.
        logger.warn('api: owner country lookup failed', { requestId, error: e instanceof Error ? e.message : String(e) });
        throw e;
    }
}

/**
 * Live profiles whose indexed email / phone / document id equals what the
 * client sent. Phones go through the SAME reader as the index and the
 * duplicate check (src/domain/phoneNumber.ts, phoneDuplicateTokens): read with
 * `country`, so "+54 9 11 6585-1333" and "11 6585-1333" are one number.
 */
export async function findIdentifierHits(db: Db, person: SearchRequest['person'], requestId: string, country: string | null): Promise<IdentifierHits> {
    const lookups: Array<{ type: string; value: string; field: MatchedOn }> = [];
    if (person.email) lookups.push({ type: 'email', value: person.email.trim().toLowerCase(), field: 'email' });
    if (person.phone) for (const t of phoneDuplicateTokens(person.phone, country)) lookups.push({ type: t.type, value: t.value, field: 'phone' });
    if (person.documentId) lookups.push({ type: 'id_number', value: normalizeDocumentId(person.documentId.value), field: 'documentId' });

    const rows = await Promise.all(lookups.map(l =>
        db.select({ adopterId: duplicateTokens.adopterId }).from(duplicateTokens)
            .where(and(eq(duplicateTokens.tokenType, l.type), eq(duplicateTokens.tokenValue, l.value)))
            .limit(50)
            .then((r: Array<{ adopterId: string }>) => r.map(x => ({ adopterId: x.adopterId, field: l.field }))),
    ));
    const matchedOn = new Map<string, MatchedOn[]>();
    for (const hit of rows.flat()) {
        const fields = matchedOn.get(hit.adopterId) ?? [];
        if (!fields.includes(hit.field)) fields.push(hit.field);
        matchedOn.set(hit.adopterId, fields);
    }

    const profiles = await Promise.all([...matchedOn.keys()].map(id =>
        db.select({
            id: adopters.id, name: adopters.name, contactEntries: adopters.contactEntries,
            householdMembers: adopters.householdMembers, isDemo: adopters.isDemo,
        }).from(adopters).where(and(eq(adopters.id, id), isNull(adopters.deletedAt))).get(),
    ));
    const candidates: CandidateNames[] = [];
    for (const p of profiles) {
        if (!p || p.isDemo) continue;
        candidates.push({
            profileId: p.id,
            name: p.name,
            aliases: deserializeContactEntries(p.contactEntries).filter(e => e.type === 'alias').map(e => e.value),
            householdNames: deserializeHouseholdMembers(p.householdMembers).map(m => m.name).filter(Boolean),
        });
    }
    // Tokens pointing at deleted / demo profiles are dropped; that's expected.
    for (const id of matchedOn.keys()) if (!candidates.some(c => c.profileId === id)) matchedOn.delete(id);
    logger.info('api: identifier lookup', { requestId, lookups: lookups.length, hits: candidates.length });
    return { candidates, matchedOn };
}

type RatingFields = Pick<ProfileSummary, 'rating' | 'ratingLevel' | 'ratingLabel'>;

export function ratingFields(avgRating: number | null): RatingFields {
    const level = avgRating === null ? 0 : getRatingDisplayLevel(avgRating);
    return {
        rating: avgRating === null ? null : Math.round(avgRating * 10) / 10,
        ratingLevel: level,
        ratingLabel: level === 0 ? 'not_rated' : getRatingLabelKey(level) as RatingFields['ratingLabel'],
    };
}

/** A stored date (Date, or seconds) as YYYY-MM-DD UTC, or null. */
function dayOf(v: unknown): string | null {
    const t = v instanceof Date ? v.getTime() : typeof v === 'number' ? v * 1000 : null;
    return t === null || Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

/**
 * Same rating, flags and "too many" signals the search cards show
 * (enrichAdopters), plus record counts, creation date and whether the caller's
 * rescue registered the person.
 *
 * FAILS CLOSED (review 2026-10-17): the search cards degrade a failed read to
 * "no data", but here that would answer a 1★ person as "not rated, no alerts".
 * Any failed read throws 503 temporarily_unavailable instead.
 */
export async function buildProfileSummaries(db: Db, ids: string[], origin: string, requestId: string, ownerEmail: string): Promise<Map<string, ProfileSummary>> {
    const out = new Map<string, ProfileSummary>();
    if (ids.length === 0) return out;
    let enriched: Awaited<ReturnType<typeof enrichAdopters>>;
    // Batched (review 2026-10-17): a 50-result fuzzy call used to fan out to ~150
    // queries. One grouped read per chunk of ids (D1-safe IN list, each id its own
    // bound parameter, as enrichAdopters does) gives counts, last date and who
    // registered each record; one more gives the creation dates.
    const CHUNK = 40;
    const groups: Array<{ adopterId: string; type: string | null; addedBy: string | null; n: number; last: unknown }> = [];
    const createdAt = new Map<string, unknown>();
    let membership: Awaited<ReturnType<typeof import('@/lib/rescueKeys')['loadOrgMembership']>>;
    let sameRescueDirect: typeof import('@/lib/rescueKeys')['sameRescueDirect'];
    try {
        const rescueKeys = await import('@/lib/rescueKeys');
        sameRescueDirect = rescueKeys.sameRescueDirect;
        const chunks: string[][] = [];
        for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
        const [e, m, parts] = await Promise.all([
            enrichAdopters(db, ids, { strict: true }),
            rescueKeys.loadOrgMembership(db, 'api.profileSummaries'),
            Promise.all(chunks.map(chunk => {
                const inList = sql.join(chunk.map(id => sql`${id}`), sql`, `);
                return Promise.all([
                    db.select({ adopterId: adoptions.adopterId, type: adoptions.recordType, addedBy: adoptions.addedBy, n: count(), last: max(adoptions.date) })
                        .from(adoptions).where(sql`${adoptions.adopterId} IN (${inList})`)
                        .groupBy(adoptions.adopterId, adoptions.recordType, adoptions.addedBy).all(),
                    db.select({ id: adopters.id, createdAt: adopters.createdAt }).from(adopters).where(sql`${adopters.id} IN (${inList})`).all(),
                ]);
            })),
        ]);
        enriched = e;
        membership = m;
        for (const [g, c] of parts as Array<[typeof groups, Array<{ id: string; createdAt: unknown }>]>) {
            groups.push(...g);
            for (const r of c) createdAt.set(r.id, r.createdAt);
        }
    } catch (e) {
        logger.error('api: profile summaries unreadable, refusing to answer without the risk', e, { requestId, profiles: ids.length });
        throw new ApiError(503, 'temporarily_unavailable', 'could not read the ratings and alerts of the matching profiles; nothing was saved — retry in a moment', { 'Retry-After': '5' });
    }
    const byProfile = new Map<string, typeof groups>();
    for (const g of groups) {
        const list = byProfile.get(g.adopterId) ?? [];
        list.push(g);
        byProfile.set(g.adopterId, list);
    }
    ids.forEach(id => {
        const e = enriched.get(id);
        const records: ProfileSummary['records'] = {};
        let last: number | null = null;
        let mine = false;
        for (const row of byProfile.get(id) ?? []) {
            // The rescue (owner or a directly shared organization) registered something here.
            if (sameRescueDirect(ownerEmail, row.addedBy, membership)) mine = true;
            if (!row.type || row.type === RECORD_TYPES.AVAILABLE) continue;
            const type = row.type as keyof ProfileSummary['records'];
            records[type] = (records[type] ?? 0) + row.n;
            const t = row.last instanceof Date ? row.last.getTime() : typeof row.last === 'number' ? row.last * 1000 : null;
            if (t !== null && (last === null || t > last)) last = t;
        }
        const f = e?.flags;
        const flags: ProfileSummary['flags'] = [];
        if (f?.inaccurate) flags.push('inaccurate');
        if (f?.duplicate) flags.push('duplicate');
        if (f?.systemDuplicate) flags.push('possible_duplicate');
        if (f?.verified_identity) flags.push('verified_identity');
        if (f?.verified_address) flags.push('verified_address');
        out.set(id, {
            profileId: id,
            url: profileUrl(origin, id),
            ...ratingFields(e?.avgRating ?? null),
            flags,
            alerts: [
                ...(f?.tooManyRequests ? [{ type: 'too_many_requests' as const, count: f.tooManyRequests.count, periodDays: f.tooManyRequests.periodDays }] : []),
                ...(f?.tooManyAdoptions ? [{ type: 'too_many_adoptions' as const, count: f.tooManyAdoptions.count, periodDays: f.tooManyAdoptions.periodDays }] : []),
            ],
            records,
            lastRecordAt: last === null ? null : new Date(last).toISOString().slice(0, 10),
            createdAt: dayOf(createdAt.get(id)),
            registeredByYourRescue: mine,
        });
    });
    return out;
}

