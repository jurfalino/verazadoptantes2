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

import { adopters, searches, adopterHistory, adoptions, adopterStats, duplicateTokens } from '@/db/schema';
import { or, like, sql, and, isNull, eq, ne } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { getDb, getUser } from './_db';
import {
    SEARCH_RESULT_LIMIT, SEARCH_ENRICHMENT_LIMIT,
    REFINEMENT_NUDGE_THRESHOLD, LOW_RELEVANCE_PERCENT_THRESHOLD,
} from '@/config/constants';
import type {
    FindAdoptersInput, FindAdoptersOptions, FindAdoptersResponse,
    DiscoveryMatch, DuplicateMatch, MatchSnippet,
} from './types';
import { enrichAdopters } from './enrichAdopters';
import { normalizeConfidence, fuzzyNameScore, SEARCH_SCORE_CEILING, PRACTICAL_MAX_DUPLICATE } from '@/lib/scoring';
import { normalizeText, extractPhones, extractEmails, extractSocials } from '@/lib/tokenizer';

// ── Shared helpers ────────────────────────────────────────────────────────────

const MIN_PHONE_DIGITS = 4;

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

async function searchHistoryMatches(db: any, tokens: string[]): Promise<DeepMatch[]> {
    try {
        const conditions = tokens.map(t => like(adopterHistory.changes, `%${escapeLike(t)}%`));
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

    const contactText = input.contactInfo || '';
    const phones = input.phones?.length ? input.phones : extractPhones(contactText);
    const emails = input.emails?.length ? input.emails : extractEmails(contactText);
    const socials = input.socials?.length ? input.socials : extractSocials(contactText);

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
        }
    }

    // Strategy 2: LIKE fallback on adopters table (catches untokenized profiles)
    const likeConditions: Array<ReturnType<typeof like>> = [];
    if (input.name) {
        const words = normalizeText(input.name).split(/\s+/).filter(w => w.length >= 3);
        for (const w of words) likeConditions.push(like(adopters.name, `%${escapeLike(w)}%`));
    }
    for (const phone of phones) {
        const d = phone.replace(/\D/g, '');
        if (d.length >= 6) likeConditions.push(like(adopters.contactInfo, `%${escapeLike(d.slice(-8))}%`));
    }
    for (const email of emails) {
        if (email.includes('@')) likeConditions.push(like(adopters.contactInfo, `%${escapeLike(email.toLowerCase())}%`));
    }
    for (const social of socials) {
        if (social.length >= 4) likeConditions.push(like(adopters.contactInfo, `%${escapeLike(social)}%`));
    }

    if (likeConditions.length > 0) {
        let likeWhere = or(...likeConditions) as any;
        if (excludeId) likeWhere = and(likeWhere, ne(adopters.id, excludeId));
        const likeRows = await db.select({ id: adopters.id }).from(adopters).where(likeWhere).limit(20);
        for (const r of likeRows) {
            if (!matchMap.has(r.id)) matchMap.set(r.id, new Set());
            matchMap.get(r.id)!.add('like_fallback');
        }
    }

    if (matchMap.size === 0) return [];

    // Fetch adopter names + stored name_word tokens for Levenshtein scoring
    // D1-compatible: fan out with eq() per ID instead of inArray() which silently breaks on D1
    const matchedIds = Array.from(matchMap.keys());
    const [nameRows, storedWordRows] = await Promise.all([
        Promise.all(matchedIds.map(id =>
            db.select({ id: adopters.id, name: adopters.name }).from(adopters)
                .where(eq(adopters.id, id)).catch(() => [])
        )).then(r => r.flat()),
        Promise.all(matchedIds.map(id =>
            db.select({ adopterId: duplicateTokens.adopterId, tokenValue: duplicateTokens.tokenValue })
                .from(duplicateTokens)
                .where(and(eq(duplicateTokens.adopterId, id), eq(duplicateTokens.tokenType, 'name_word')))
                .catch(() => [])
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
        address_word: 1, source_url: 3, like_fallback: 0.5,
    };

    const inputNameWords = rawTokens.filter(t => t.type === 'name_word').map(t => t.value);

    const results: DuplicateMatch[] = [];
    for (const row of nameRows) {
        const types = Array.from(matchMap.get(row.id) || []);
        let score = types.reduce((s, t) => s + (weights[t] || 1), 0);

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

        const relevancePercent = normalizeConfidence(score, PRACTICAL_MAX_DUPLICATE);
        if (relevancePercent < minRelevance) continue;

        const hasToken = types.some(t => t !== 'like_fallback');
        const hasLike = types.includes('like_fallback');
        const source: DuplicateMatch['source'] = hasToken && hasLike ? 'both' : hasToken ? 'token' : 'like';

        results.push({ adopterId: row.id, adopterName: row.name, relevancePercent, matchTypes: types, source });
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

    if (isPhoneLikeQuery(normalizedQuery) && countDigits(normalizedQuery) < MIN_PHONE_DIGITS)
        return { results: [], validationError: 'min_digits' };

    if (isUnauthenticated) {
        if (normalizedQuery.includes('@') || (isPhoneLikeQuery(normalizedQuery) && countDigits(normalizedQuery) >= MIN_PHONE_DIGITS))
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
    if (userCountry) profileConds.push(eq(adopters.country, userCountry));

    const [directResults, historyMatches, adoptionMatches] = await Promise.all([
        db.select().from(adopters).where(and(...profileConds)).limit(SEARCH_ENRICHMENT_LIMIT),
        searchHistoryMatches(db, tokens),
        searchAdoptionMatches(db, tokens),
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

    const extraIds = new Set([...historyIds, ...adoptionIds]);
    directResults.forEach((r: any) => extraIds.delete(r.id));

    // D1-compatible: fan out with eq() per ID instead of inArray() which silently breaks on D1
    let extraProfiles: typeof adopters.$inferSelect[] = [];
    if (extraIds.size > 0) {
        const extraProfileResults = await Promise.all(
            Array.from(extraIds).map(id => {
                const conds: any[] = [eq(adopters.id, id)];
                if (userCountry) conds.push(eq(adopters.country, userCountry));
                return db.select().from(adopters).where(and(...conds)).catch(() => []);
            })
        );
        extraProfiles = extraProfileResults.flat();
    }

    const allProfiles = [...directResults, ...extraProfiles];
    if (allProfiles.length === 0) return { results: [] };

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

        // Name
        const nl = a.name?.toLowerCase() || '';
        if (nl === qLower) {
            score += WEIGHTS.name_exact; matchTypes.push('name_exact');
            const s = buildSnippet('name', a.name, normalizedQuery, tokens);
            if (s && WEIGHTS.name_exact > bestSnippetWeight) { bestSnippet = s; bestSnippetWeight = WEIGHTS.name_exact; }
        } else if (nl.includes(qLower)) {
            score += WEIGHTS.name_contains; matchTypes.push('name_contains');
            const s = buildSnippet('name', a.name, normalizedQuery, tokens);
            if (s && WEIGHTS.name_contains > bestSnippetWeight) { bestSnippet = s; bestSnippetWeight = WEIGHTS.name_contains; }
        } else if (isMultiToken && allTokensMatch(a.name, tokens)) {
            score += WEIGHTS.name_tokens; matchTypes.push('name_tokens');
            const s = buildSnippet('name', a.name, normalizedQuery, tokens);
            if (s && WEIGHTS.name_tokens > bestSnippetWeight) { bestSnippet = s; bestSnippetWeight = WEIGHTS.name_tokens; }
        } else if (isMultiToken && anyTokenMatch(a.name, tokens)) {
            const m = countTokenMatches(a.name, tokens);
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

        const result: DiscoveryMatch = {
            adopterId: a.id,
            adopterName: a.name,
            relevancePercent,
            matchTypes,
            source: 'like', // LIKE-based discovery (token index not used in this mode)
            adopter: { ...a },
            matchSnippet: bestSnippet ? { ...bestSnippet } : null,
            avgRating: enrichment?.avgRating ?? null,
            thumbnail: enrichment?.thumbnail ?? null,
            stats: enrichment?.stats ?? defaultStats,
            flags: enrichment?.flags ?? defaultFlags,
        };

        // PII masking for unauthenticated users
        if (isUnauthenticated) {
            result.adopter = { ...result.adopter };
            result.adopter.name = result.adopter.name?.length > 3 ? result.adopter.name.slice(0, 3) + '••••' : '••••';
            result.adopter.contactInfo = result.adopter.contactInfo
                ?.replace(/(\d{2,3})[\d\s\-.()]{4,}/g, '$1••••••')
                ?.replace(/[a-zA-Z0-9._%+-]+@/g, '•••@') || null;
            result.adopter.familyMembers = null;
            result.adopter.addressInfo = null;
            if (result.matchSnippet) {
                result.matchSnippet = { ...result.matchSnippet, snippet: '', highlights: [] };
            }
            result.relevancePercent = 0;
        }

        return result;
    });

    allResults.sort((a, b) => b.relevancePercent - a.relevancePercent);

    // Low-relevance bucketing
    let mainResults = allResults;
    let lowRelevanceResults: DiscoveryMatch[] = [];
    if (isMultiToken) {
        mainResults = allResults.filter(r => r.relevancePercent >= LOW_RELEVANCE_PERCENT_THRESHOLD);
        lowRelevanceResults = allResults.filter(r => r.relevancePercent < LOW_RELEVANCE_PERCENT_THRESHOLD);
    }

    const singleTokenResultCount = (!isMultiToken && allResults.length > REFINEMENT_NUDGE_THRESHOLD)
        ? allResults.length : undefined;

    const totalCount = mainResults.length;
    logger.info('findAdopters:discovery', { query: normalizedQuery, tokens: tokens.length, resultCount: Math.min(totalCount, limit), user });
    logAudit({ userEmail: user, action: 'search', details: { query: normalizedQuery, resultCount: Math.min(totalCount, limit) } });

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
            const results = await runDuplicateMode(input, options, db);
            return { results };
        }

        // Discovery mode: auth context, enrichment, geo-filter, analytics
        try { user = await getUser(); } catch { /* unauthenticated */ }
        return await runDiscoveryMode(input, options, db, user);

    } catch (error) {
        const errorId = logger.error('findAdopters failed', error, { mode: options.mode, user });
        throw new Error(`findAdopters failed (ID: ${errorId})`);
    }
}
