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
import { enrichAdopters } from '@/app/actions/enrichAdopters';
import { getRatingDisplayLevel, getRatingLabelKey } from '@/domain/ratings';
import { RECORD_TYPES } from '@/domain/constants';
import { openAlertKinds } from '@/domain/flags';
import { normalizeDocumentId, type CandidateNames } from '@/domain/apiExactMatch';
import { foldHolderName, MAX_NAMES_PER_IDENTIFIER, type IdentifierKind, type SharedIdentifier } from '@/domain/identityVerdict';
import { phoneDuplicateTokens } from '@/domain/phoneNumber';
import { apiSocialHandles, type ProfileSummary, type SearchRequest } from './schemas';
import type { IdentifierHits, MatchedOn } from './exactVerdict';
import { ApiError } from './handler';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;
export type { MatchedOn, IdentifierHits } from './exactVerdict';
export { judgeHits, exactOutcomeOf } from './exactVerdict';

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
    return findIdentifierHitsFor(db, {
        emails: person.email ? [person.email] : [],
        phones: person.phone ? [person.phone] : [],
        documentIds: person.documentId ? [person.documentId.value] : [],
        // Accounts only (the first 3): a display name ("Ana Perez") has no handle and looks nobody up.
        socials: apiSocialHandles(person.socials),
    }, requestId, country);
}

/**
 * Several identifiers of one person (a sheet row with two phones): the same lookup as findIdentifierHits.
 * `socials`: handles as `normalizeSocialHandle` returns them (looked up as `social_handle`, as the index stores them).
 */
export interface IdentifierSet { emails: string[]; phones: string[]; documentIds: string[]; socials?: string[] }

type Lookup = { type: string; value: string; field: MatchedOn };

function identifierLookups(ids: IdentifierSet, country: string | null): Lookup[] {
    const lookups: Lookup[] = [];
    const push = (l: Lookup) => {
        if (l.value && !lookups.some(x => x.type === l.type && x.value === l.value)) lookups.push(l);
    };
    for (const e of ids.emails) push({ type: 'email', value: e.trim().toLowerCase(), field: 'email' });
    for (const p of ids.phones) for (const t of phoneDuplicateTokens(p, country)) push({ type: t.type, value: t.value, field: 'phone' });
    for (const d of ids.documentIds) push({ type: 'id_number', value: normalizeDocumentId(d), field: 'documentId' });
    for (const h of ids.socials ?? []) push({ type: 'social_handle', value: h, field: 'social' });
    return lookups;
}

const KIND_OF: Record<MatchedOn, IdentifierKind> = { email: 'email', phone: 'phone', documentId: 'document', social: 'social' };

/**
 * What each hit profile shares, one entry per lookup that hit it, with the number of
 * distinct (folded) names among the live hit profiles holding that same token. A phone's
 * last-8 suffix is not counted again when the full number hit the profile too.
 */
function sharedOf(lookups: Lookup[], hitsPerLookup: string[][], names: Map<string, string>, idEntries: Map<string, Set<string>>, namesHoldingOf: Map<number, number>): Map<string, SharedIdentifier[]> {
    const out = new Map<string, SharedIdentifier[]>();
    lookups.forEach((l, i) => {
        const holders = [...new Set(hitsPerLookup[i])].filter(id => names.has(id));
        // A social handle's count comes from its holders' names (socialHolders), not from the profiles read.
        const namesHolding = namesHoldingOf.get(i) ?? new Set(holders.map(id => foldHolderName(names.get(id)!))).size;
        for (const id of holders) {
            if (l.type === 'phone_suffix' && lookups.some((m, j) => m.type === 'phone' && hitsPerLookup[j].includes(id))) continue;
            const list = out.get(id) ?? [];
            // A DNI is the profile's own only in its `id` entry; one read from a free-text note
            // identifies like an email or a phone (ruling R10).
            list.push({
                kind: KIND_OF[l.field], value: l.value, namesHolding,
                ...(l.field === 'documentId' ? { inIdEntry: idEntries.get(id)?.has(l.value) === true } : {}),
            });
            out.set(id, list);
        }
    });
    return out;
}

/** At most how many D1 queries findIdentifierHitsFor issues for `ids` with `maxProfiles` (a caller's budget).
 *  A social handle may cost one more (socialHolders' name probe). */
export function identifierQueryCount(ids: IdentifierSet, country: string | null, maxProfiles: number): number {
    const lookups = identifierLookups(ids, country);
    return lookups.length + lookups.filter(l => l.field === 'social').length + maxProfiles;
}

/** Holders read per lookup (and the name sample of a social handle). */
const HOLDERS_SAMPLE = 50;
/** At most this many profiles reached ONLY through one social handle that is not junk are read (the others are left out). */
export const MAX_SOCIAL_HOLDERS_READ = 10;

/**
 * The live, non-demo profiles holding a social handle, and how many distinct (folded) names
 * they have — counted BEFORE any profile is read, so a placeholder or the rescue's own account
 * typed by hundreds costs no profile reads. When the holder sample is full but shows at most
 * MAX_NAMES_PER_IDENTIFIER names, one more query reads up to HOLDERS_SAMPLE distinct names, so
 * a handle with more names is junk whatever the sample.
 */
async function socialHolders(db: Db, l: Lookup): Promise<{ ids: string[]; namesHolding: number }> {
    const where = and(eq(duplicateTokens.tokenType, l.type), eq(duplicateTokens.tokenValue, l.value), isNull(adopters.deletedAt), eq(adopters.isDemo, 0));
    const rows: Array<{ adopterId: string; name: string }> = await db.select({ adopterId: duplicateTokens.adopterId, name: adopters.name })
        .from(duplicateTokens).innerJoin(adopters, eq(adopters.id, duplicateTokens.adopterId))
        .where(where).limit(HOLDERS_SAMPLE);
    const names = new Set(rows.map(r => foldHolderName(r.name)));
    if (rows.length === HOLDERS_SAMPLE && names.size <= MAX_NAMES_PER_IDENTIFIER) {
        const more: Array<{ name: string }> = await db.selectDistinct({ name: adopters.name })
            .from(duplicateTokens).innerJoin(adopters, eq(adopters.id, duplicateTokens.adopterId))
            .where(where).limit(HOLDERS_SAMPLE);
        for (const r of more) names.add(foldHolderName(r.name));
    }
    return { ids: [...new Set(rows.map(r => r.adopterId))], namesHolding: names.size };
}

/**
 * `maxProfiles`: read only that many hit profiles, those matched on the most
 * identifiers first — so a caller can bound its D1 queries (the API leaves it unset).
 */
export async function findIdentifierHitsFor(db: Db, ids: IdentifierSet, requestId: string, country: string | null, opts: { maxProfiles?: number } = {}): Promise<IdentifierHits> {
    const lookups = identifierLookups(ids, country);

    const found: Array<{ ids: string[]; namesHolding?: number }> = await Promise.all(lookups.map(l =>
        l.field === 'social' ? socialHolders(db, l) :
            db.select({ adopterId: duplicateTokens.adopterId }).from(duplicateTokens)
                .where(and(eq(duplicateTokens.tokenType, l.type), eq(duplicateTokens.tokenValue, l.value)))
                .limit(HOLDERS_SAMPLE)
                .then((r: Array<{ adopterId: string }>) => ({ ids: r.map(x => x.adopterId) })),
    ));
    // Social handles: a junk one (held by more than MAX_NAMES_PER_IDENTIFIER names: applicants typing
    // the rescue's own account) is nobody — it reaches only profiles another identifier already hit,
    // where it counts for nothing. A real one reads at most MAX_SOCIAL_HOLDERS_READ profiles, those
    // another identifier hit first. Social only: the other identifier types answer as they always did.
    const hitByOther = new Set(found.flatMap((f, i) => (lookups[i].field === 'social' ? [] : f.ids)));
    const namesHoldingOf = new Map<number, number>();
    let socialJunk = 0;
    let socialCut = 0;
    const hitsPerLookup = found.map((f, i) => {
        if (lookups[i].field !== 'social' || f.namesHolding === undefined) return f.ids;
        namesHoldingOf.set(i, f.namesHolding);
        if (f.namesHolding > MAX_NAMES_PER_IDENTIFIER) { socialJunk++; return f.ids.filter(id => hitByOther.has(id)); }
        const only = f.ids.filter(id => !hitByOther.has(id));
        socialCut += Math.max(0, only.length - MAX_SOCIAL_HOLDERS_READ);
        return [...f.ids.filter(id => hitByOther.has(id)), ...only.slice(0, MAX_SOCIAL_HOLDERS_READ)];
    });
    const matchedOn = new Map<string, MatchedOn[]>();
    for (const hit of hitsPerLookup.flatMap((ids, i) => ids.map(adopterId => ({ adopterId, field: lookups[i].field })))) {
        const fields = matchedOn.get(hit.adopterId) ?? [];
        if (!fields.includes(hit.field)) fields.push(hit.field);
        matchedOn.set(hit.adopterId, fields);
    }

    const hitIds = [...matchedOn.keys()];
    if (opts.maxProfiles !== undefined && hitIds.length > opts.maxProfiles) {
        hitIds.sort((a, b) => matchedOn.get(b)!.length - matchedOn.get(a)!.length);
        for (const id of hitIds.splice(opts.maxProfiles)) matchedOn.delete(id);
    }
    const profiles = await Promise.all(hitIds.map(id =>
        db.select({
            id: adopters.id, name: adopters.name, contactEntries: adopters.contactEntries, isDemo: adopters.isDemo,
        }).from(adopters).where(and(eq(adopters.id, id), isNull(adopters.deletedAt))).get(),
    ));
    const live = profiles.filter((p): p is NonNullable<typeof p> => !!p && !p.isDemo);
    // A profile's OWN names only: a housemate is a profile of its own, found by its own
    // tokens (households as profiles — no `household_member` match any more).
    const entriesOf = new Map(live.map(p => [p.id, deserializeContactEntries(p.contactEntries)]));
    const candidates: CandidateNames[] = live.map(p => ({
        profileId: p.id,
        name: p.name,
        aliases: entriesOf.get(p.id)!.filter(e => e.type === 'alias').map(e => e.value),
    }));
    const idEntries = new Map(live.map(p => [p.id, new Set(entriesOf.get(p.id)!.filter(e => e.type === 'id').map(e => normalizeDocumentId(e.value)))]));
    // Tokens pointing at deleted / demo profiles are dropped; that's expected.
    for (const id of matchedOn.keys()) if (!candidates.some(c => c.profileId === id)) matchedOn.delete(id);
    const shared = sharedOf(lookups, hitsPerLookup, new Map(candidates.map(c => [c.profileId, c.name])), idEntries, namesHoldingOf);
    logger.info('api: identifier lookup', {
        requestId, lookups: lookups.length, hits: candidates.length,
        ...(socialJunk ? { socialJunk } : {}), ...(socialCut ? { socialHoldersNotRead: socialCut } : {}),
    });
    return { candidates, matchedOn, shared };
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
        // `inaccurate` and `duplicate` are the person's open alerts, by the app's one rule
        // (openAlertKinds — the profile header's): a duplicate report only while it is open,
        // never one closed by a merge or a «mantener separados» (Jon, 2026-10-28).
        const flags: ProfileSummary['flags'] = [...openAlertKinds(f)];
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

