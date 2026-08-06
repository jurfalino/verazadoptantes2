'use server';

/**
 * findAdopters — Unified Search Engine
 *
 * Single entry point for both discovery search (SearchSection, AdoptionWizard, etc.)
 * and duplicate detection (ImportWizard, AdopterForm creation check, contract route).
 *
 * Mode = 'discovery'  → full adopter row, enrichment, geo-filter, PII masking, search logging
 * Mode = 'duplicate'  → lightweight DuplicateMatch[], no auth, no enrichment, no analytics
 *
 * SQL gate fix: name_word tokens use prefix-LIKE (stored LIKE 'input%' OR input LIKE stored%)
 * followed by JS Levenshtein scoring so typo variants (Jonatan/Jonathan) are never dropped.
 */

import { adopters, searches, adopterHistory, adoptions, adopterStats, duplicateTokens, piiAccessGrants } from '@/db/schema';
import { or, like, sql, and, isNull, eq, ne } from 'drizzle-orm';
import { logger, withTrace } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { getDb, getUser } from './_db';
import {
    SEARCH_RESULT_LIMIT, SEARCH_ENRICHMENT_LIMIT,
    REFINEMENT_NUDGE_THRESHOLD, LOW_RELEVANCE_PERCENT_THRESHOLD,
    PHONE_SEARCH_MIN_DIGITS,
} from '@/config/constants';
import type {
    FindAdoptersInput, FindAdoptersOptions, FindAdoptersResponse,
    DiscoveryMatch, DuplicateMatch, MatchSnippet,
} from './types';
import { enrichAdopters } from './enrichAdopters';
import { normalizeConfidence, fuzzyNameScore, SEARCH_SCORE_CEILING, PRACTICAL_MAX_DUPLICATE } from '@/lib/scoring';
import { normalizeText, extractPhones, extractEmails, extractSocials, isPlaceholderPhone, extractIds, stripIdsFromText } from '@/lib/tokenizer';
import { count } from 'drizzle-orm';
import { matchSearchEntries, matchSearchNameTokens, hashNameToken, NO_ACCESS_VISIBILITY, type Visibility } from '@/lib/piiAccess';
import { assembleDiscoveryMatch } from '@/lib/discoveryMatch';
import { isPiiGatingEnabled, isPublicProfilesEnabled, resolveAdoptersVisibility, maskOptionsFor } from '@/lib/piiAccessServer';
import { deserializeContactEntries } from '@/lib/contactEntries';

// ── Shared helpers ────────────────────────────────────────────────────────────

function isPhoneLikeQuery(q: string): boolean {
    const d = q.replace(/[\s\-\.\(\)\+]/g, '');
    const cnt = (d.match(/\d/g) || []).length;
    return cnt > 0 && cnt / d.length > 0.5;
}

function countDigits(q: string): number {
    return (q.match(/\d/g) || []).length;
}

function escapeLike(s: string): string {
    return s.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function tokenize(q: string): string[] {
    const t = q.split(/\s+/).filter(x => x.length >= 2);
    return t.length > 0 ? t : [q];
}

function allTokensMatch(text: string | null | undefined, tokens: string[]): boolean {
    if (!text) return false;
    const l = text.toLowerCase();
    return tokens.every(t => l.includes(t.toLowerCase()));
}

function anyTokenMatch(text: string | null | undefined, tokens: string[]): boolean {
    if (!text) return false;
    const l = text.toLowerCase();
    return tokens.some(t => l.includes(t.toLowerCase()));
}

function countTokenMatches(text: string | null | undefined, tokens: string[]): number {
    if (!text) return 0;
    const l = text.toLowerCase();
    return tokens.filter(t => l.includes(t.toLowerCase())).length;
}

// ── Snippet extraction ────────────────────────────────────────────────────────

function extractSnippet(text: string, query: string, tokens: string[], maxLen = 80): { snippet: string; highlights: { start: number; end: number }[] } | null {
    const lt = text.toLowerCase();
    let anchorIdx = lt.indexOf(query.toLowerCase());
    let anchorLen = query.length;
    if (anchorIdx === -1) {
        for (const t of tokens) {
            const idx = lt.indexOf(t.toLowerCase());
            if (idx !== -1) { anchorIdx = idx; anchorLen = t.length; break; }
        }
    }
    if (anchorIdx === -1) return null;
    const matchEnd = anchorIdx + anchorLen;
    const half = Math.floor((maxLen - anchorLen) / 2);
    let start = Math.max(0, anchorIdx - half);
    let end = Math.min(text.length, matchEnd + half);
    if (start === 0) end = Math.min(text.length, maxLen);
    if (end === text.length) start = Math.max(0, text.length - maxLen);
    let snippet = text.slice(start, end).trim();
    snippet = (start > 0 ? '...' : '') + snippet + (end < text.length ? '...' : '');
    const sl = snippet.toLowerCase();
    const rawH: { start: number; end: number }[] = [];
    for (const t of tokens) {
        const tl = t.toLowerCase(); let from = 0;
        while (from < sl.length) {
            const idx = sl.indexOf(tl, from);
            if (idx === -1) break;
            rawH.push({ start: idx, end: idx + t.length });
            from = idx + t.length;
        }
    }
    rawH.sort((a, b) => a.start - b.start);
    const highlights: { start: number; end: number }[] = [];
    for (const h of rawH) {
        const last = highlights[highlights.length - 1];
        if (last && h.start <= last.end) last.end = Math.max(last.end, h.end);
        else highlights.push({ ...h });
    }
    return { snippet, highlights };
}

function buildSnippet(field: MatchSnippet['field'], text: string | null | undefined, query: string, tokens: string[]): MatchSnippet | null {
    if (!text) return null;
    const r = extractSnippet(text, query, tokens);
    if (!r) return null;
    return { field, ...r };
}

// ── Discovery deep search helpers ─────────────────────────────────────────────

interface DeepMatch { adopterId: string; matchedText: string; }

/**
 * Search adopter_history for matches against the query tokens (v2.17.2).
 *
 * Previously this ran `LIKE %query% ON adopterHistory.changes` — a substring
 * match against the entire JSON blob of every history row. That blob carries
 * a lot of metadata that has nothing to do with adopter content:
 *
 *   {"contributed_entry":{"type":"phone"}}          // from addContactEntry
 *   {"appended_from_create_flow":{"appendedFields":[...]}} // from appendToExistingAdopter
 *   {"adoption_updated":{...}}                      // from adoptions.ts
 *   {"name":{"from":"...","to":"..."}}              // from saveAdopter
 *
 * A search for "Mariela" would match against keys like `appendedFields` or
 * historic JSON fragments that happen to include the substring without
 * Mariela ever being part of an adopter's actual data. The bug report:
 * adopter profiles surfaced as matches when the only "Mariela" in the audit
 * log was metadata, not adopter content.
 *
 * Fix: restrict to specific JSON paths within `changes` that we KNOW carry
 * name-bearing adopter values:
 *
 *   - `$.name.from` / `$.name.to`                    (saveAdopter name change)
 *   - `$.familyMembers.from` / `$.familyMembers.to`  (saveAdopter family change)
 *
 * `status` from/to is also a name field path but holds 1-5 rating strings,
 * never a person name. `contributed_entry.type` is a fixed enum
 * ('phone'/'email'/'social'/...) and shouldn't be searchable. Adoption-update
 * rows aren't surfaced from here at all (searchAdoptionMatches handles
 * adoption content via the canonical `adoptions` table). D1's SQLite build
 * supports `json_extract` natively; rows whose JSON shape doesn't include
 * the requested path return NULL and silently don't match — exactly what we
 * want for the legacy shapes above.
 */
async function searchHistoryMatches(db: any, tokens: string[]): Promise<DeepMatch[]> {
    try {
        const NAME_PATHS = ['$.name.from', '$.name.to', '$.familyMembers.from', '$.familyMembers.to'];
        const conditions = tokens.flatMap(t => {
            const pattern = `%${escapeLike(t)}%`;
            return NAME_PATHS.map(p =>
                sql`json_extract(${adopterHistory.changes}, ${p}) LIKE ${pattern}`
            );
        });
        if (conditions.length === 0) return [];
        const logs = await db.select({ adopterId: adopterHistory.adopterId, changes: adopterHistory.changes })
            .from(adopterHistory)
            .where(conditions.length === 1 ? conditions[0] : or(...conditions))
            .limit(SEARCH_RESULT_LIMIT);
        return logs.map((l: any) => ({ adopterId: l.adopterId, matchedText: l.changes || '' }));
    } catch (e) {
        logger.warn('History search error', { error: e instanceof Error ? e.message : String(e) });
        return [];
    }
}

async function searchAdoptionMatches(db: any, tokens: string[]): Promise<DeepMatch[]> {
    try {
        const conds = tokens.flatMap(t => [
            like(adoptions.animalName, `%${escapeLike(t)}%`),
            like(adoptions.details, `%${escapeLike(t)}%`),
        ]);
        const rows = await db.select({ adopterId: adoptions.adopterId, animalName: adoptions.animalName, details: adoptions.details })
            .from(adoptions)
            .where(conds.length === 1 ? conds[0] : or(...conds))
            .limit(SEARCH_RESULT_LIMIT);
        return rows.map((l: any) => {
            const nm = countTokenMatches(l.animalName, tokens);
            const dm = countTokenMatches(l.details, tokens);
            return { adopterId: l.adopterId, matchedText: nm >= dm ? (l.animalName || '') : (l.details || '') };
        });
    } catch (e) {
        logger.warn('Adoption search error', { error: e instanceof Error ? e.message : String(e) });
        return [];
    }
}

/**
 * Phone-token lookup against `duplicate_tokens` (v2.16.0-17). The discovery LIKE
 * path runs on `adopters.contactInfo` which stores the user's verbatim phone
 * formatting ("Tel: 6462-2274"), so a digit-only query ("64622274") slides past
 * the LIKE substring. The tokenizer canonicalizes phones to digits-only when
 * populating duplicate_tokens, so the same digit-only query matches there.
 *
 * v2.26.6: also fire on a phone number typed INSIDE a mixed "name + phone" query
 * (e.g. "jonathan urfalino 1165851333"). Previously this whole function was
 * gated on `isPhoneLikeQuery(WHOLE query)`, which is false when letters dominate,
 * so the format-agnostic phone match was skipped and the only phone matching left
 * was a raw contactInfo LIKE that breaks on "+549"/formatting — the record was
 * silently missed even though the searcher typed the exact number. We now gather
 * candidate digit-strings two ways and union the lookups:
 *   1. whole-query concatenation when the query is phone-shaped (formatted pure-
 *      phone queries like "6462-2274" / "11 6585 1333") — the original behaviour.
 *   2. each contiguous digit run of >= PHONE_SEARCH_MIN_DIGITS anywhere in the
 *      query — catches an unformatted phone token embedded in a name query.
 * The min-digits floor keeps the anti-fishing posture; short address numbers
 * ("calle 6462") don't qualify. Additive — IDs flow through the same extras
 * union + enrichment + masking pipeline as history/adoption matches.
 */
async function searchPhoneTokenMatches(db: any, normalizedQuery: string): Promise<string[]> {
    try {
        const candidates = new Set<string>();
        // (1) formatted pure-phone queries: concatenate all digits.
        if (isPhoneLikeQuery(normalizedQuery)) {
            const allDigits = normalizedQuery.replace(/\D/g, '');
            if (allDigits.length >= PHONE_SEARCH_MIN_DIGITS) candidates.add(allDigits);
        }
        // (2) an unformatted phone token embedded in a mixed query.
        for (const run of normalizedQuery.match(new RegExp(`\\d{${PHONE_SEARCH_MIN_DIGITS},}`, 'g')) ?? []) {
            candidates.add(run);
        }
        if (candidates.size === 0) return [];

        const digitConds = Array.from(candidates).map(d =>
            like(duplicateTokens.tokenValue, `%${escapeLike(d)}%`));
        const rows = await db.select({ adopterId: duplicateTokens.adopterId })
            .from(duplicateTokens)
            .where(and(
                or(
                    eq(duplicateTokens.tokenType, 'phone'),
                    eq(duplicateTokens.tokenType, 'phone_suffix'),
                ),
                or(...digitConds),
            ))
            .limit(SEARCH_RESULT_LIMIT);
        return rows.map((r: { adopterId: string }) => r.adopterId);
    } catch (e) {
        logger.warn('Phone-token search error', { error: e instanceof Error ? e.message : String(e) });
        return [];
    }
}

/**
 * Accent-insensitive name recall (v2.26.7). Discovery's SQL name LIKE runs on the
 * verbatim `adopters.name` column, which is accent-SENSITIVE in SQLite — so a
 * query "jose" never fetches a stored "José", and the record can't even be scored.
 * The tokenizer writes `duplicate_tokens` name_word/name_full values NFD-stripped
 * (tokenizer.ts:25-31), so we normalize the query tokens and EXACT-match them
 * against that index to surface the accent variants. Exact (not prefix) keeps it
 * tight — "jose" surfaces "José"/"Jose", not "Josefina"; loose prefix/fuzzy name
 * recall belongs to the lazy weak tier (duplicate engine), not the eager path.
 * Additive: IDs flow through the same extras union + enrichment + masking as the
 * phone-token path.
 */
async function searchNameTokenMatches(db: any, tokens: string[]): Promise<string[]> {
    try {
        const normTokens = [...new Set(tokens.map(t => normalizeText(t)).filter(t => t.length >= 2))];
        if (normTokens.length === 0) return [];
        const valueConds = normTokens.map(t => eq(duplicateTokens.tokenValue, t));
        const rows = await db.select({ adopterId: duplicateTokens.adopterId })
            .from(duplicateTokens)
            .where(and(
                or(
                    eq(duplicateTokens.tokenType, 'name_word'),
                    eq(duplicateTokens.tokenType, 'name_full'),
                ),
                or(...valueConds),
            ))
            .limit(SEARCH_RESULT_LIMIT);
        return rows.map((r: { adopterId: string }) => r.adopterId);
    } catch (e) {
        logger.warn('Name-token search error', { error: e instanceof Error ? e.message : String(e) });
        return [];
    }
}

// ── Discovery scoring weights ─────────────────────────────────────────────────

const WEIGHTS = {
    name_exact: 100, name_contains: 50, name_tokens: 35, name_partial: 20,
    contact: 40, contact_partial: 25,
    address: 25, address_partial: 15,
    family: 20, family_partial: 12,
    adoption: 15, history: 10,
    query_coverage_full: 40,
    has_thumbnail: 5, has_rating: 3, verified: 2, recent_update: 3,
} as const;

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

function buildProfileSearchConditions(tokens: string[]) {
    const fields = [adopters.name, adopters.contactInfo, adopters.addressInfo, adopters.familyMembers];
    if (tokens.length === 1) return or(...fields.map(f => like(f, `%${escapeLike(tokens[0])}%`)));
    return or(...tokens.flatMap(t => fields.map(f => like(f, `%${escapeLike(t)}%`))));
}

// ── Duplicate mode engine ─────────────────────────────────────────────────────

async function runDuplicateMode(
    input: FindAdoptersInput,
    options: FindAdoptersOptions,
    db: any,
): Promise<DuplicateMatch[]> {
    const limit = options.limit ?? 5;
    const minRelevance = options.minRelevance ?? 15;

    // Build input tokens from structured fields
    const rawTokens: Array<{ type: string; value: string }> = [];

    if (input.name) {
        const normalized = normalizeText(input.name);
        if (normalized.length >= 3) {
            rawTokens.push({ type: 'name_full', value: normalized });
            for (const word of normalized.split(/\s+/)) {
                if (word.length >= 3) rawTokens.push({ type: 'name_word', value: word });
            }
        }
    }

    // Harvest IDs / phones / emails / socials across ALL free-text input fields so a
    // phone typed in the name field (or address) doesn't fragment into name_word
    // tokens. Mirrors the tokenizer's all-text concatenation. IDs are extracted
    // first and stripped from the phone-extraction text so a "DNI: 12345678" can't
    // also tokenize as a phone.
    const allInputText = [
        input.contactInfo || '',
        input.name || '',
    ].join('\n');
    const ids = extractIds(allInputText);
    for (const id of ids) rawTokens.push({ type: 'id_number', value: id });

    const phoneText = stripIdsFromText(allInputText);
    const rawPhones = input.phones?.length ? input.phones : extractPhones(phoneText);
    // Apply placeholder filter to pre-parsed phones too — extractPhones already filters internally.
    const phones = rawPhones.filter(p => !isPlaceholderPhone(p.replace(/\D/g, '')));
    const emails = input.emails?.length ? input.emails : extractEmails(allInputText);
    const socials = input.socials?.length ? input.socials : extractSocials(allInputText);

    for (const phone of phones) {
        const digits = phone.replace(/\D/g, '');
        if (digits.length >= 6) {
            rawTokens.push({ type: 'phone', value: digits });
            rawTokens.push({ type: 'phone_suffix', value: digits.slice(-8) });
        }
    }
    for (const email of emails) rawTokens.push({ type: 'email', value: email.toLowerCase().trim() });
    for (const social of socials) rawTokens.push({ type: 'social', value: social.toLowerCase().trim() });

    if (rawTokens.length === 0) return [];

    const excludeId = input.excludeAdopterId;

    // Strategy 1: Token index — SQL gate fix: use prefix-LIKE instead of exact eq
    // so minor typos don't silently prevent the JS Levenshtein step from running.
    // name_word tokens use prefix-LIKE; phone/email/social stay exact (security).
    const matchMap = new Map<string, Set<string>>();
    // Per-adopter list of (type, value) pairs that triggered the match — used for chip rendering.
    const matchValuesMap = new Map<string, Array<{ type: string; value: string }>>();
    // Set of unique (type|value) pairs we'll later count for popularity-based down-ranking.
    const popularityProbes = new Set<string>();

    function recordMatchValue(adopterId: string, type: string, value: string) {
        if (!matchValuesMap.has(adopterId)) matchValuesMap.set(adopterId, []);
        const arr = matchValuesMap.get(adopterId)!;
        // Dedup by (type, value) per adopter
        if (!arr.some(v => v.type === type && v.value === value)) arr.push({ type, value });
    }

    for (const token of rawTokens) {
        let rows: Array<{ adopterId: string; tokenValue: string }>;

        if (token.type === 'name_word' || token.type === 'name_full') {
            // Prefix-LIKE: catches 'jonathan' when stored as 'jonatan' and vice-versa
            // D1/SQLite safe formulation:
            rows = await db.select({ adopterId: duplicateTokens.adopterId, tokenValue: duplicateTokens.tokenValue })
                .from(duplicateTokens)
                .where(and(
                    eq(duplicateTokens.tokenType, token.type),
                    like(duplicateTokens.tokenValue, `${escapeLike(token.value.slice(0, Math.max(3, token.value.length - 2)))}%`)
                ))
                .limit(20);
        } else {
            // Exact match for phone/email/social — must stay precise
            rows = await db.select({ adopterId: duplicateTokens.adopterId, tokenValue: duplicateTokens.tokenValue })
                .from(duplicateTokens)
                .where(and(
                    eq(duplicateTokens.tokenType, token.type),
                    eq(duplicateTokens.tokenValue, token.value),
                ))
                .limit(20);
        }

        for (const m of rows) {
            if (excludeId && m.adopterId === excludeId) continue;
            if (!matchMap.has(m.adopterId)) matchMap.set(m.adopterId, new Set());
            matchMap.get(m.adopterId)!.add(token.type);
            // Capture the stored token value that triggered the match — that's what UI chips show.
            recordMatchValue(m.adopterId, token.type, m.tokenValue);
            popularityProbes.add(`${token.type}|${m.tokenValue}`);
        }
    }

    // Strategy 2: LIKE fallback on adopters table (catches untokenized profiles).
    // v2.19.24: split into two queries — name-column LIKE recorded as
    // 'like_fallback_name', contact-info LIKE recorded as 'like_fallback_contact'.
    // The downstream "strong signal" filter needs to know whether a fallback-only
    // candidate actually had matching contact data or just a name collision; the
    // previous single 'like_fallback' bucket made that impossible to disambiguate.
    const nameLikeConditions: Array<ReturnType<typeof like>> = [];
    if (input.name) {
        const words = normalizeText(input.name).split(/\s+/).filter(w => w.length >= 3);
        for (const w of words) nameLikeConditions.push(like(adopters.name, `%${escapeLike(w)}%`));
    }
    const contactLikeConditions: Array<ReturnType<typeof like>> = [];
    for (const phone of phones) {
        const d = phone.replace(/\D/g, '');
        if (d.length >= 6) contactLikeConditions.push(like(adopters.contactInfo, `%${escapeLike(d.slice(-8))}%`));
    }
    for (const email of emails) {
        if (email.includes('@')) contactLikeConditions.push(like(adopters.contactInfo, `%${escapeLike(email.toLowerCase())}%`));
    }
    for (const social of socials) {
        if (social.length >= 4) contactLikeConditions.push(like(adopters.contactInfo, `%${escapeLike(social)}%`));
    }

    const runLikeFallback = async (
        conditions: Array<ReturnType<typeof like>>,
        bucket: 'like_fallback_name' | 'like_fallback_contact',
    ) => {
        if (conditions.length === 0) return;
        const base = and(or(...conditions), isNull(adopters.deletedAt));
        const where = excludeId ? and(base, ne(adopters.id, excludeId)) : base;
        const likeRows = await db.select({ id: adopters.id }).from(adopters).where(where).limit(20);
        for (const r of likeRows) {
            if (!matchMap.has(r.id)) matchMap.set(r.id, new Set());
            matchMap.get(r.id)!.add(bucket);
        }
    };
    await runLikeFallback(nameLikeConditions, 'like_fallback_name');
    await runLikeFallback(contactLikeConditions, 'like_fallback_contact');

    if (matchMap.size === 0) return [];

    // Fetch adopter names + stored name_word tokens for Levenshtein scoring.
    // D1-compatible: fan out with eq() per ID instead of inArray() which silently breaks on D1.
    // The eq+isNull guard drops soft-deleted IDs that may have entered matchMap via the token-index
    // strategy (Strategy 1 doesn't join against adopters, so its candidates aren't pre-filtered).
    const matchedIds = Array.from(matchMap.keys());
    const [nameRows, storedWordRows] = await Promise.all([
        Promise.all(matchedIds.map(id =>
            db.select({ id: adopters.id, name: adopters.name }).from(adopters)
                .where(and(eq(adopters.id, id), isNull(adopters.deletedAt)))
                .catch((e: unknown) => {
                    logger.warn('findAdopters: D1 fallback hit (adopter name lookup)', {
                        adopterId: id,
                        error: e instanceof Error ? e.message : String(e),
                    });
                    return [];
                })
        )).then(r => r.flat()),
        Promise.all(matchedIds.map(id =>
            db.select({ adopterId: duplicateTokens.adopterId, tokenValue: duplicateTokens.tokenValue })
                .from(duplicateTokens)
                .where(and(eq(duplicateTokens.adopterId, id), eq(duplicateTokens.tokenType, 'name_word')))
                .catch((e: unknown) => {
                    logger.warn('findAdopters: D1 fallback hit (name_word tokens)', {
                        adopterId: id,
                        error: e instanceof Error ? e.message : String(e),
                    });
                    return [];
                })
        )).then(r => r.flat()),
    ]);

    const storedWordsByAdopter = new Map<string, string[]>();
    for (const r of storedWordRows) {
        if (!storedWordsByAdopter.has(r.adopterId)) storedWordsByAdopter.set(r.adopterId, []);
        storedWordsByAdopter.get(r.adopterId)!.push(r.tokenValue);
    }

    const weights: Record<string, number> = {
        phone: 3, phone_suffix: 2, email: 3, social: 3,
        name_full: 2, name_phonetic: 1.5, name_word: 1,
        address_word: 1, source_url: 3,
        // v2.19.24: split former 'like_fallback'. Contact-info fallback is a
        // strong signal (phone/email digits found in the contactInfo blob),
        // name fallback is a weak coincidence.
        like_fallback_name: 0.5, like_fallback_contact: 1.5,
        id_number: 3, // unique identity, same tier as phone/email
    };

    // v2.19.24: classification used by the false-positive suppression rule
    // below. "Strong" identity signals are ones the rescuer explicitly used
    // to assert "this is THE person" — phone, email, social handle, ID
    // number, or those same values caught by the contact-info LIKE fallback.
    // Name signals (full, word, phonetic, fuzzy, name-column LIKE) are
    // population-level coincidences when isolated.
    const STRONG_SIGNAL_TYPES = new Set([
        'phone', 'phone_suffix', 'email', 'social', 'id_number', 'source_url',
        'like_fallback_contact',
    ]);
    const NAME_SIGNAL_TYPES = new Set([
        'name_full', 'name_word', 'name_phonetic', 'name_word_fuzzy',
        'like_fallback_name',
    ]);
    const hasStrongInputSignal = rawTokens.some(t =>
        ['phone', 'email', 'social', 'id_number'].includes(t.type),
    );

    // Popularity down-ranking: tokens shared by many records are weak identity signals.
    // Only ambiguous-by-nature types are subject to down-ranking; phone/email/social/source_url
    // are unique identifiers and stay at full weight even if (rarely) shared.
    const POPULARITY_THRESHOLDS: Record<string, number> = {
        phone_suffix: 5, name_word: 20, address_word: 30,
    };
    const popularityCounts = new Map<string, number>();
    if (popularityProbes.size > 0) {
        const probes = Array.from(popularityProbes)
            .map(k => { const [t, ...rest] = k.split('|'); return { type: t, value: rest.join('|') }; })
            .filter(p => p.type in POPULARITY_THRESHOLDS);
        const probeRows = await Promise.all(probes.map(p =>
            db.select({ n: count() }).from(duplicateTokens)
                .where(and(eq(duplicateTokens.tokenType, p.type), eq(duplicateTokens.tokenValue, p.value)))
                .catch((e: unknown) => {
                    logger.warn('findAdopters: D1 fallback hit (popularity probe)', {
                        type: p.type, error: e instanceof Error ? e.message : String(e),
                    });
                    return [{ n: 0 }];
                })
        ));
        probes.forEach((p, i) => {
            popularityCounts.set(`${p.type}|${p.value}`, probeRows[i]?.[0]?.n ?? 0);
        });
    }

    function adjustedWeight(type: string, value: string): number {
        const base = weights[type] || 1;
        const threshold = POPULARITY_THRESHOLDS[type];
        if (!threshold) return base;
        const n = popularityCounts.get(`${type}|${value}`) ?? 0;
        return n > threshold ? base * 0.5 : base;
    }

    const inputNameWords = rawTokens.filter(t => t.type === 'name_word').map(t => t.value);

    const results: DuplicateMatch[] = [];
    for (const row of nameRows) {
        const types = Array.from(matchMap.get(row.id) || []);
        const matchValues = matchValuesMap.get(row.id) || [];
        // Score = sum of per-(type,value) adjusted weights for every distinct token-pair that fired,
        // plus a flat weight contribution for types that have no captured value (like_fallback).
        let score = 0;
        const typesWithValues = new Set(matchValues.map(v => v.type));
        for (const v of matchValues) score += adjustedWeight(v.type, v.value);
        for (const t of types) {
            if (!typesWithValues.has(t)) score += weights[t] || 1; // e.g. like_fallback
        }

        // Levenshtein fuzzy bonus — per-input-token, capped at 1.0 each
        const storedWords = storedWordsByAdopter.get(row.id) || [];
        for (const inputWord of inputNameWords) {
            let best = 0;
            for (const stored of storedWords) {
                if (inputWord === stored) continue;
                const f = fuzzyNameScore(inputWord, stored);
                if (f > best) best = f;
            }
            if (best > 0) { score += best; if (!types.includes('name_word_fuzzy')) types.push('name_word_fuzzy'); }
        }

        // v2.19.24: false-positive suppression. When the rescuer provided a
        // strong identity signal (phone / email / social / id) AND none of
        // those signals matched on this candidate AND the matched types are
        // name-only, drop the candidate. Rationale: "Susana + phone X"
        // shouldn't return every "Susana ANYTHING" in the DB just because
        // the prefix-LIKE name tokens collide — the user explicitly
        // asserted "this is the person with phone X", and a different
        // Susana with a different phone is by definition NOT that person.
        // If the candidate has no strong-signal storage at all (no phones,
        // emails, socials, ids stored), the name match still gets dropped
        // here — that's the right call: we can't confirm it's the same
        // person from name alone, and the user can still find the
        // candidate via the search surface, just not via duplicate
        // detection.
        if (hasStrongInputSignal) {
            const hitStrong = types.some(t => STRONG_SIGNAL_TYPES.has(t));
            const onlyNameSignals = types.every(t => NAME_SIGNAL_TYPES.has(t));
            if (!hitStrong && onlyNameSignals) continue;
        }

        const relevancePercent = normalizeConfidence(score, PRACTICAL_MAX_DUPLICATE);
        if (relevancePercent < minRelevance) continue;

        const hasToken = types.some(t => !t.startsWith('like_fallback'));
        const hasLike = types.some(t => t.startsWith('like_fallback'));
        const source: DuplicateMatch['source'] = hasToken && hasLike ? 'both' : hasToken ? 'token' : 'like';

        results.push({ adopterId: row.id, adopterName: row.name, relevancePercent, matchTypes: types, matchValues, source });
    }

    return results.sort((a, b) => b.relevancePercent - a.relevancePercent).slice(0, limit);
}

// ── Discovery mode engine ─────────────────────────────────────────────────────

async function runDiscoveryMode(
    input: FindAdoptersInput,
    options: FindAdoptersOptions,
    db: any,
    user: string,
): Promise<FindAdoptersResponse> {
    const limit = options.limit ?? SEARCH_RESULT_LIMIT;
    const shouldEnrich = options.enrich !== false; // default true
    const normalizedQuery = (input.raw || input.name || '').trim();
    if (!normalizedQuery) return { results: [] };

    const isUnauthenticated = user === 'unknown';

    if (isPhoneLikeQuery(normalizedQuery) && countDigits(normalizedQuery) < PHONE_SEARCH_MIN_DIGITS)
        return { results: [], validationError: 'min_digits' };

    if (isUnauthenticated) {
        if (normalizedQuery.includes('@') || (isPhoneLikeQuery(normalizedQuery) && countDigits(normalizedQuery) >= PHONE_SEARCH_MIN_DIGITS))
            return { results: [], validationError: 'login_required' };
    }

    const tokens = tokenize(normalizedQuery);
    const isMultiToken = tokens.length > 1;

    // Geo-filtering
    let userCountry: string | null = null;
    try {
        const { env } = (await import('@cloudflare/next-on-pages')).getRequestContext();
        if (env?.DB) {
            const row = await env.DB.prepare(
                `SELECT up.country FROM user_profiles up JOIN user u ON u.id = up.user_id WHERE u.email = ? LIMIT 1`
            ).bind(user).first<{ country: string | null }>();
            userCountry = row?.country || null;
        }
    } catch { /* best-effort */ }

    // Log search query (fire-and-forget)
    (async () => {
        try {
            await db.insert(searches).values({
                id: crypto.randomUUID(), query: normalizedQuery, type: 'general',
                count: 1, lastSearchedAt: new Date(),
            }).onConflictDoUpdate({
                target: searches.query,
                set: { count: sql`count + 1`, lastSearchedAt: new Date() },
            });
        } catch (e) { logger.warn('Failed to log search query', { error: e instanceof Error ? e.message : String(e) }); }
    })();

    // Parallel: profile LIKE + deep search
    const profileConds: any[] = [isNull(adopters.deletedAt), buildProfileSearchConditions(tokens)];
    if (userCountry) {
        // v2.19.1: owned records bypass the geo filter. The country gate exists
        // for cross-org relevance — a rescuer searching the global registry
        // doesn't need adopters from other countries cluttering results — but
        // it shouldn't ever hide YOUR OWN records. Before this fix, a rescuer
        // who created an adopter without setting country (or whose adopter sits
        // in a different country than their user_profile) would search by name
        // and watch the record fail to appear, with no signal as to why.
        const ownerEmail = user && user !== 'unknown' ? user : null;
        profileConds.push(ownerEmail
            ? or(eq(adopters.country, userCountry), eq(adopters.addedBy, ownerEmail))
            : eq(adopters.country, userCountry)
        );
    }

    const [directResults, historyMatches, adoptionMatches, phoneTokenIds, nameTokenIds] = await Promise.all([
        db.select().from(adopters).where(and(...profileConds)).limit(SEARCH_ENRICHMENT_LIMIT),
        searchHistoryMatches(db, tokens),
        searchAdoptionMatches(db, tokens),
        // v2.16.0-17: catches digit-only phone queries (e.g. "64622274") that
        // the LIKE search above misses because the stored contactInfo blob
        // keeps the user's verbatim formatting ("Tel: 6462-2274").
        searchPhoneTokenMatches(db, normalizedQuery),
        // v2.26.7: accent-insensitive name recall — surfaces "José" for "jose"
        // via the NFD-stripped name-token index (the direct LIKE is accent-sensitive).
        searchNameTokenMatches(db, tokens),
    ]);

    const historyTextMap = new Map<string, string>();
    const adoptionTextMap = new Map<string, string>();
    const historyIds: string[] = [];
    const adoptionIds: string[] = [];

    for (const m of historyMatches) {
        historyIds.push(m.adopterId);
        if (!historyTextMap.has(m.adopterId)) historyTextMap.set(m.adopterId, m.matchedText);
    }
    for (const m of adoptionMatches) {
        adoptionIds.push(m.adopterId);
        if (!adoptionTextMap.has(m.adopterId)) adoptionTextMap.set(m.adopterId, m.matchedText);
    }

    const extraIds = new Set([...historyIds, ...adoptionIds, ...phoneTokenIds, ...nameTokenIds]);
    directResults.forEach((r: any) => extraIds.delete(r.id));

    // D1-compatible: fan out with eq() per ID instead of inArray() which silently breaks on D1
    let extraProfiles: typeof adopters.$inferSelect[] = [];
    if (extraIds.size > 0) {
        // v2.19.2: same owner-relax as the directResults gate at line ~567.
        // Phone-token / history / adoption-match paths correctly find the
        // adopter ID, but the geo filter here would then re-exclude any
        // record whose country doesn't match the viewer's profile country —
        // including the viewer's OWN records (e.g. adopter 84da04dc-… with
        // country=null + addedBy=viewer). That's the second half of the
        // "phone search returns other records, not the one with that phone"
        // bug from v2.19.1.
        const ownerEmail = user && user !== 'unknown' ? user : null;
        const extraProfileResults = await Promise.all(
            Array.from(extraIds).map(id => {
                const conds: any[] = [eq(adopters.id, id)];
                if (userCountry) {
                    conds.push(ownerEmail
                        ? or(eq(adopters.country, userCountry), eq(adopters.addedBy, ownerEmail))
                        : eq(adopters.country, userCountry)
                    );
                }
                return db.select().from(adopters).where(and(...conds)).catch((e: unknown) => {
                    logger.warn('findAdopters: D1 fallback hit (extra adopter profile lookup)', {
                        adopterId: id,
                        userCountry,
                        error: e instanceof Error ? e.message : String(e),
                    });
                    return [];
                });
            })
        );
        extraProfiles = extraProfileResults.flat();
    }

    const allProfiles = [...directResults, ...extraProfiles];
    if (allProfiles.length === 0) return { results: [] };

    // PII access gating: resolve per-result visibility once for the whole batch.
    const piiGatingOn = !isUnauthenticated && await isPiiGatingEnabled();
    const visibilityMap = piiGatingOn
        ? await resolveAdoptersVisibility(
            user,
            allProfiles.map((a: typeof adopters.$inferSelect) => ({ id: a.id, addedBy: a.addedBy })),
        )
        : null;
    // Public-profiles flag is read once and then applied per-adopter via the
    // adopter's `isPublic` column (v2.16.0-12+).
    const publicProfilesFlag = piiGatingOn && await isPublicProfilesEnabled();
    // Search-match grants discovered while masking; persisted after the map.
    const newGrants: Array<{ adopterId: string; entryRef: string; scope: 'entry' | 'name_token' }> = [];

    const adopterIds = allProfiles.map((a: any) => a.id);
    const enrichmentMap = shouldEnrich ? await enrichAdopters(db, adopterIds) : new Map();

    // Log search hits (fire-and-forget)
    (async () => {
        try {
            for (const a of allProfiles) {
                await db.insert(adopterStats).values({
                    id: crypto.randomUUID(), adopterId: a.id,
                    eventType: 'search_hit', userId: user, createdAt: new Date(),
                });
            }
        } catch (e) { logger.warn('Failed to log search hits', { error: e instanceof Error ? e.message : String(e) }); }
    })();

    const qLower = normalizedQuery.toLowerCase();
    // v2.26.7: accent-normalized query for the NAME cascade so "jose" scores as a
    // name match against a stored "José" (the record is now fetched via the
    // name-token recall path above). Contact/address stay on qLower — they're
    // mostly digits/handles and address accent-folding can wait.
    const qNorm = normalizeText(normalizedQuery);
    const tokensNorm = tokens.map(t => normalizeText(t));
    // v2.27.0: per-result token coverage (fraction of query tokens matched), used
    // to demote partial matches on multi-token queries into the weak tier.
    const coverageById = new Map<string, number>();
    const defaultStats = { searchHits: 0, profileViews: 0, requests: 0, adoptions: 0 };
    const defaultFlags = {
        inaccurate: false, duplicate: false, systemDuplicate: false,
        verified_identity: false, verified_address: false,
        tooManyAdoptions: null, tooManyRequests: null,
    };

    const allResults: DiscoveryMatch[] = allProfiles.map((a: any) => {
        const enrichment = enrichmentMap.get(a.id);
        let score = 0;
        let bestSnippet: MatchSnippet | null = null;
        let bestSnippetWeight = 0;
        const matchTypes: string[] = [];

        // Name (accent-insensitive — v2.26.7). Comparisons run on NFD-stripped
        // strings so "jose"/"José" match; snippets keep the original text.
        const nlNorm = normalizeText(a.name || '');
        if (nlNorm === qNorm) {
            score += WEIGHTS.name_exact; matchTypes.push('name_exact');
            const s = buildSnippet('name', a.name, normalizedQuery, tokens);
            if (s && WEIGHTS.name_exact > bestSnippetWeight) { bestSnippet = s; bestSnippetWeight = WEIGHTS.name_exact; }
        } else if (nlNorm.includes(qNorm)) {
            score += WEIGHTS.name_contains; matchTypes.push('name_contains');
            const s = buildSnippet('name', a.name, normalizedQuery, tokens);
            if (s && WEIGHTS.name_contains > bestSnippetWeight) { bestSnippet = s; bestSnippetWeight = WEIGHTS.name_contains; }
        } else if (isMultiToken && allTokensMatch(nlNorm, tokensNorm)) {
            score += WEIGHTS.name_tokens; matchTypes.push('name_tokens');
            const s = buildSnippet('name', a.name, normalizedQuery, tokens);
            if (s && WEIGHTS.name_tokens > bestSnippetWeight) { bestSnippet = s; bestSnippetWeight = WEIGHTS.name_tokens; }
        } else if (isMultiToken && anyTokenMatch(nlNorm, tokensNorm)) {
            const m = countTokenMatches(nlNorm, tokensNorm);
            score += Math.round(WEIGHTS.name_partial * (m / tokens.length)); matchTypes.push('name_partial');
            const s = buildSnippet('name', a.name, normalizedQuery, tokens);
            if (s && WEIGHTS.name_partial > bestSnippetWeight) { bestSnippet = s; bestSnippetWeight = WEIGHTS.name_partial; }
        }

        // Contact
        if (a.contactInfo?.toLowerCase().includes(qLower)) {
            score += WEIGHTS.contact; matchTypes.push('contact');
            const s = buildSnippet('contact', a.contactInfo, normalizedQuery, tokens);
            if (s && WEIGHTS.contact > bestSnippetWeight) { bestSnippet = s; bestSnippetWeight = WEIGHTS.contact; }
        } else if (isMultiToken && anyTokenMatch(a.contactInfo, tokens)) {
            const m = countTokenMatches(a.contactInfo, tokens);
            score += Math.round(WEIGHTS.contact_partial * (m / tokens.length)); matchTypes.push('contact_partial');
            const s = buildSnippet('contact', a.contactInfo, normalizedQuery, tokens);
            if (s && WEIGHTS.contact_partial > bestSnippetWeight) { bestSnippet = s; bestSnippetWeight = WEIGHTS.contact_partial; }
        }

        // Address
        if (a.addressInfo?.toLowerCase().includes(qLower)) {
            score += WEIGHTS.address; matchTypes.push('address');
            const s = buildSnippet('address', a.addressInfo, normalizedQuery, tokens);
            if (s && WEIGHTS.address > bestSnippetWeight) { bestSnippet = s; bestSnippetWeight = WEIGHTS.address; }
        } else if (isMultiToken && anyTokenMatch(a.addressInfo, tokens)) {
            const m = countTokenMatches(a.addressInfo, tokens);
            score += Math.round(WEIGHTS.address_partial * (m / tokens.length)); matchTypes.push('address_partial');
            const s = buildSnippet('address', a.addressInfo, normalizedQuery, tokens);
            if (s && WEIGHTS.address_partial > bestSnippetWeight) { bestSnippet = s; bestSnippetWeight = WEIGHTS.address_partial; }
        }

        // Family
        if (a.familyMembers?.toLowerCase().includes(qLower)) {
            score += WEIGHTS.family; matchTypes.push('family');
            const s = buildSnippet('family', a.familyMembers, normalizedQuery, tokens);
            if (s && WEIGHTS.family > bestSnippetWeight) { bestSnippet = s; bestSnippetWeight = WEIGHTS.family; }
        } else if (isMultiToken && anyTokenMatch(a.familyMembers, tokens)) {
            const m = countTokenMatches(a.familyMembers, tokens);
            score += Math.round(WEIGHTS.family_partial * (m / tokens.length)); matchTypes.push('family_partial');
            const s = buildSnippet('family', a.familyMembers, normalizedQuery, tokens);
            if (s && WEIGHTS.family_partial > bestSnippetWeight) { bestSnippet = s; bestSnippetWeight = WEIGHTS.family_partial; }
        }

        // Deep search
        if (adoptionIds.includes(a.id)) {
            score += WEIGHTS.adoption; matchTypes.push('adoption');
            const matchedText = adoptionTextMap.get(a.id);
            if (matchedText && WEIGHTS.adoption > bestSnippetWeight) {
                const s = buildSnippet('adoption', matchedText, normalizedQuery, tokens);
                if (s) { bestSnippet = s; bestSnippetWeight = WEIGHTS.adoption; }
            }
        }
        if (historyIds.includes(a.id)) {
            score += WEIGHTS.history; matchTypes.push('history');
            if (WEIGHTS.history > bestSnippetWeight) {
                bestSnippet = { field: 'history', snippet: '', highlights: [] };
                bestSnippetWeight = WEIGHTS.history;
            }
        }

        // Cross-field coverage bonus
        if (isMultiToken) {
            const allText = [a.name, a.contactInfo, a.addressInfo, a.familyMembers, adoptionTextMap.get(a.id), historyTextMap.get(a.id)].filter(Boolean).join(' ');
            const covered = countTokenMatches(allText, tokens) / tokens.length;
            coverageById.set(a.id, covered); // v2.27.0: drives partial-match demotion below
            score += covered >= 1 ? WEIGHTS.query_coverage_full : Math.round(WEIGHTS.query_coverage_full * covered * 0.5);
        }

        // Bonus signals
        if (enrichment?.thumbnail) score += WEIGHTS.has_thumbnail;
        if (enrichment?.avgRating != null) score += WEIGHTS.has_rating;
        if (enrichment?.flags.verified_identity) score += WEIGHTS.verified;
        if (a.updatedAt) {
            const ms = typeof a.updatedAt === 'number' ? a.updatedAt * 1000 : new Date(a.updatedAt).getTime();
            if (Date.now() - ms < NINETY_DAYS_MS) score += WEIGHTS.recent_update;
        }

        const relevancePercent = normalizeConfidence(score, SEARCH_SCORE_CEILING);

        const enrichmentVals = {
            avgRating: enrichment?.avgRating ?? null,
            thumbnail: enrichment?.thumbnail ?? null,
            stats: enrichment?.stats ?? defaultStats,
            flags: enrichment?.flags ?? defaultFlags,
        };
        const meta = {
            relevancePercent,
            matchTypes,
            matchValues: [] as Array<{ type: string; value: string }>, // discovery mode doesn't track per-token values
            source: 'like' as const, // LIKE-based discovery (token index not used in this mode)
            matchSnippet: bestSnippet ? { ...bestSnippet } : null,
        };

        // Unified mask for any non-privileged viewer (unauth — always — and
        // auth without grants when the flag is on). Auth viewers additionally
        // accrue search-match grants so their reveals persist across visits;
        // unauth viewers can't (grants are keyed on `granteeEmail`).
        let vis: Visibility | undefined;
        if (isUnauthenticated) vis = NO_ACCESS_VISIBILITY;
        else if (visibilityMap) vis = visibilityMap.get(a.id);

        // Public-profile bypass: when the whole record is admin-flagged
        // public AND the feature flag is on, treat the viewer as if they
        // had nothing-masked visibility for this row.
        const maskOpts = maskOptionsFor(publicProfilesFlag, a);

        // Search-match grant write (auth only). Contact-entry and name-token
        // matches both write a grant and augment `vis` so this response renders
        // the unlocked values. (The actual masking is done by the shared
        // assembler below, the same path the walkthrough demo uses.)
        if (vis && !vis.nothingMasked && !maskOpts.adopterIsPublic && !isUnauthenticated) {
            const entryMatches = matchSearchEntries(deserializeContactEntries(a.contactEntries), normalizedQuery);
            if (entryMatches.length > 0) {
                const unlocked = new Set(vis.unlockedEntryHashes);
                for (const m of entryMatches) {
                    if (!unlocked.has(m.hash)) {
                        unlocked.add(m.hash);
                        newGrants.push({ adopterId: a.id, entryRef: m.hash, scope: 'entry' });
                    }
                }
                // Anchor-grade identifier match is strong evidence the viewer
                // means THIS person — auto-grant every name token too (skips
                // initials / single-char tokens which can't self-grant).
                const unlockedNames = new Set(vis.unlockedNameTokenHashes);
                for (const token of (a.name ?? '').trim().split(/\s+/)) {
                    if (token.length < 2) continue;
                    const h = hashNameToken(token);
                    if (!unlockedNames.has(h)) {
                        unlockedNames.add(h);
                        newGrants.push({ adopterId: a.id, entryRef: h, scope: 'name_token' });
                    }
                }
                vis = { ...vis, unlockedEntryHashes: unlocked, unlockedNameTokenHashes: unlockedNames, tier: 'partial' };
            }
            const nameMatches = matchSearchNameTokens(a.name, normalizedQuery);
            if (nameMatches.length > 0) {
                const unlockedNames = new Set(vis.unlockedNameTokenHashes);
                for (const token of nameMatches) {
                    const h = hashNameToken(token);
                    if (!unlockedNames.has(h)) {
                        unlockedNames.add(h);
                        newGrants.push({ adopterId: a.id, entryRef: h, scope: 'name_token' });
                    }
                }
                vis = { ...vis, unlockedNameTokenHashes: unlockedNames, tier: 'partial' };
            }
        }

        // Shared assembly + partial-reveal mask (also used by the walkthrough
        // demo, so the two can't drift). `vis` undefined ⇒ no masking.
        return assembleDiscoveryMatch({ ...a }, enrichmentVals, meta, vis, normalizedQuery, maskOpts);
    });

    allResults.sort((a, b) => b.relevancePercent - a.relevancePercent);

    // Low-relevance bucketing. v2.27.0: a multi-token query keeps in the MAIN
    // list only results that cover ALL query tokens (or matched a strong digit
    // identifier — phone/DNI — which must stay strong per the v2.26.6 fix, even
    // if the name half of the query didn't match). Partial-coverage matches
    // (e.g. "maipu 888" for a "maipu 1955" search) drop to the weak tier so the
    // top list stays high-signal. Very-low-relevance results also drop.
    let mainResults = allResults;
    let lowRelevanceResults: DiscoveryMatch[] = [];
    if (isMultiToken) {
        const strongIdMatch = new Set<string>(phoneTokenIds);
        const isStrong = (r: DiscoveryMatch) =>
            r.relevancePercent >= LOW_RELEVANCE_PERCENT_THRESHOLD
            && ((coverageById.get(r.adopterId) ?? 1) >= 1 || strongIdMatch.has(r.adopterId));
        mainResults = allResults.filter(isStrong);
        lowRelevanceResults = allResults.filter(r => !isStrong(r));
    }

    const singleTokenResultCount = (!isMultiToken && allResults.length > REFINEMENT_NUDGE_THRESHOLD)
        ? allResults.length : undefined;

    const totalCount = mainResults.length;
    logger.info('findAdopters:discovery', { query: normalizedQuery, tokens: tokens.length, resultCount: Math.min(totalCount, limit), user });
    logAudit({ userEmail: user, action: 'search', details: { query: normalizedQuery, resultCount: Math.min(totalCount, limit) } });

    // PII access gating: persist search-match grants — one row per newly matched
    // entry. Awaited so the reveal survives to the viewer's next visit. A write
    // failure is logged but never breaks search (the viewer just re-grants).
    if (newGrants.length > 0) {
        try {
            await Promise.all(newGrants.map(g => db.insert(piiAccessGrants).values({
                id: crypto.randomUUID(),
                adopterId: g.adopterId,
                granteeEmail: user,
                scope: g.scope,
                entryRef: g.entryRef,
                origin: 'search_match',
                grantedByEmail: user,
                createdAt: new Date(),
            })));
            logAudit({
                userEmail: user,
                action: 'pii_search_match_grant',
                details: { count: newGrants.length, adopterIds: [...new Set(newGrants.map(g => g.adopterId))] },
            });
        } catch (e) {
            logger.warn('findAdopters: PII search-match grant write failed', {
                user, count: newGrants.length,
                error: e instanceof Error ? e.message : String(e),
            });
        }
    }

    const response: FindAdoptersResponse = {
        results: mainResults.slice(0, limit),
        ...(lowRelevanceResults.length > 0 && { lowRelevanceResults: lowRelevanceResults.slice(0, limit) }),
        ...(singleTokenResultCount !== undefined && { singleTokenResultCount }),
    };
    if (totalCount > limit) { response.truncated = true; response.totalCount = totalCount; }
    return response;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Unified adopter search engine.
 *
 * @example Discovery search (SearchSection, AdoptionWizard, ReportWizard, AdopterFlagging, AdopterForm)
 * ```ts
 * const res = await findAdopters({ raw: query }, { mode: 'discovery', enrich: true });
 * const matches = res.results as DiscoveryMatch[];
 * ```
 *
 * @example Duplicate detection (ImportWizard, contract route)
 * ```ts
 * const res = await findAdopters({ name, phones, emails }, { mode: 'duplicate' });
 * const matches = res.results as DuplicateMatch[];
 * ```
 */
export async function findAdopters(
    input: FindAdoptersInput,
    options: FindAdoptersOptions,
): Promise<FindAdoptersResponse> {
    let user = 'unknown';
    try {
        const db = await getDb();
        if (!db) return { results: [] };

        if (options.mode === 'duplicate') {
            // Duplicate mode: no auth, no enrichment, no analytics
            const results = await withTrace(
                'findAdopters.duplicate',
                () => runDuplicateMode(input, options, db),
                {
                    nameLen: (input.name || '').length,
                    phones: input.phones?.length || 0,
                    emails: input.emails?.length || 0,
                    socials: input.socials?.length || 0,
                },
            );
            return { results };
        }

        // Discovery mode: auth context, enrichment, geo-filter, analytics
        try { user = await getUser(); } catch { /* unauthenticated */ }
        return await withTrace(
            'findAdopters.discovery',
            () => runDiscoveryMode(input, options, db, user),
            { rawLen: (input.raw || '').length, enrich: options.enrich !== false },
        );

    } catch (error) {
        const errorId = logger.error('findAdopters failed', error, { mode: options.mode, user });
        throw new Error(`findAdopters failed (ID: ${errorId})`);
    }
}
