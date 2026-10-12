/**
 * Read side of the API: find the profiles an identifier hits (exact mode) and
 * describe a profile (both modes). Server-only.
 *
 * D1 note: no IN-lists (they mis-bind on D1); every lookup fans out with
 * Promise.all over single-value queries.
 */
import { and, count, eq, isNull, max } from 'drizzle-orm';
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
        // Phones are then read as Argentine (the default region), never dropped.
        logger.warn('api: owner country lookup failed', { requestId, error: e instanceof Error ? e.message : String(e) });
        return null;
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

/** Same rating, flags and "too many" signals the search cards show (enrichAdopters), plus record counts. */
export async function buildProfileSummaries(db: Db, ids: string[], origin: string, requestId: string): Promise<Map<string, ProfileSummary>> {
    const out = new Map<string, ProfileSummary>();
    if (ids.length === 0) return out;
    const [enriched, counts] = await Promise.all([
        enrichAdopters(db, ids),
        Promise.all(ids.map(id =>
            db.select({ type: adoptions.recordType, n: count(), last: max(adoptions.date) })
                .from(adoptions).where(eq(adoptions.adopterId, id)).groupBy(adoptions.recordType)
                .catch((e: unknown) => {
                    logger.warn('api: record counts D1 fallback hit', { requestId, adopterId: id, error: e instanceof Error ? e.message : String(e) });
                    return [];
                }),
        )),
    ]);
    ids.forEach((id, i) => {
        const e = enriched.get(id);
        const records: Record<string, number> = {};
        let last: number | null = null;
        for (const row of counts[i] as Array<{ type: string | null; n: number; last: unknown }>) {
            if (!row.type || row.type === RECORD_TYPES.AVAILABLE) continue;
            records[row.type] = row.n;
            const t = row.last instanceof Date ? row.last.getTime() : typeof row.last === 'number' ? row.last * 1000 : null;
            if (t !== null && (last === null || t > last)) last = t;
        }
        const f = e?.flags;
        const flags: string[] = [];
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
            tooManyRequests: f?.tooManyRequests ? { count: f.tooManyRequests.count, periodDays: f.tooManyRequests.periodDays } : null,
            tooManyAdoptions: f?.tooManyAdoptions ? { count: f.tooManyAdoptions.count, periodDays: f.tooManyAdoptions.periodDays } : null,
            records,
            lastRecordAt: last === null ? null : new Date(last).toISOString().slice(0, 10),
        });
    });
    return out;
}
