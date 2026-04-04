'use server';

import { adopters, searches, adopterHistory, adoptions, adopterStats } from '@/db/schema';
import { or, like, sql, and, isNull, inArray, eq } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { getDb, getUser } from './_db';
import { SEARCH_RESULT_LIMIT, SEARCH_ENRICHMENT_LIMIT } from '@/config/constants';
import type { SearchResponse, MatchSnippet } from './types';
import { enrichAdopters } from './enrichAdopters';

const MIN_PHONE_DIGITS = 4;

// Helper to detect if query looks like a phone number
function isPhoneLikeQuery(query: string): boolean {
    const digitsOnly = query.replace(/[\s\-\.\(\)\+]/g, '');
    const digitCount = (digitsOnly.match(/\d/g) || []).length;
    return digitCount > 0 && digitCount / digitsOnly.length > 0.5;
}

function countDigits(query: string): number {
    return (query.match(/\d/g) || []).length;
}

// ── P1: LIKE wildcard escaping ──────────────────────────────────────

/** Escape SQL LIKE wildcards so user input is treated as literal text */
function escapeLike(str: string): string {
    return str.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

// ── Tokenization ────────────────────────────────────────────────────

function tokenize(query: string): string[] {
    const tokens = query.split(/\s+/).filter(t => t.length >= 2);
    return tokens.length > 0 ? tokens : [query];
}

function allTokensMatch(text: string | null | undefined, tokens: string[]): boolean {
    if (!text) return false;
    const lower = text.toLowerCase();
    return tokens.every(t => lower.includes(t.toLowerCase()));
}

function anyTokenMatch(text: string | null | undefined, tokens: string[]): boolean {
    if (!text) return false;
    const lower = text.toLowerCase();
    return tokens.some(t => lower.includes(t.toLowerCase()));
}

function countTokenMatches(text: string | null | undefined, tokens: string[]): number {
    if (!text) return 0;
    const lower = text.toLowerCase();
    return tokens.filter(t => lower.includes(t.toLowerCase())).length;
}

// ── P3: Multi-token snippet extraction ──────────────────────────────

/**
 * Extract snippet with highlight ranges for ALL matching tokens.
 * Centers the window on the best anchor (full query > first token).
 * Then finds every token occurrence within the window.
 */
function extractSnippet(text: string, query: string, tokens: string[], maxLen = 80): { snippet: string; highlights: { start: number; end: number }[] } | null {
    const lowerText = text.toLowerCase();

    // Find anchor position for window centering
    let anchorIdx = lowerText.indexOf(query.toLowerCase());
    let anchorLen = query.length;

    if (anchorIdx === -1) {
        for (const token of tokens) {
            const idx = lowerText.indexOf(token.toLowerCase());
            if (idx !== -1) {
                anchorIdx = idx;
                anchorLen = token.length;
                break;
            }
        }
    }

    if (anchorIdx === -1) return null;

    // Build text window
    const matchEnd = anchorIdx + anchorLen;
    const halfWindow = Math.floor((maxLen - anchorLen) / 2);
    let start = Math.max(0, anchorIdx - halfWindow);
    let end = Math.min(text.length, matchEnd + halfWindow);

    if (start === 0) end = Math.min(text.length, maxLen);
    if (end === text.length) start = Math.max(0, text.length - maxLen);

    let snippet = text.slice(start, end).trim();
    const prefix = start > 0 ? '...' : '';
    const suffix = end < text.length ? '...' : '';
    snippet = prefix + snippet + suffix;

    // Find ALL token highlights within the final snippet
    const snippetLower = snippet.toLowerCase();
    const rawHighlights: { start: number; end: number }[] = [];

    for (const token of tokens) {
        const tokenLower = token.toLowerCase();
        let searchFrom = 0;
        while (searchFrom < snippetLower.length) {
            const idx = snippetLower.indexOf(tokenLower, searchFrom);
            if (idx === -1) break;
            rawHighlights.push({ start: idx, end: idx + token.length });
            searchFrom = idx + token.length;
        }
    }

    // Sort and merge overlapping ranges
    rawHighlights.sort((a, b) => a.start - b.start);
    const highlights: { start: number; end: number }[] = [];
    for (const h of rawHighlights) {
        const last = highlights[highlights.length - 1];
        if (last && h.start <= last.end) {
            last.end = Math.max(last.end, h.end);
        } else {
            highlights.push({ ...h });
        }
    }

    return { snippet, highlights };
}

function buildSnippet(
    field: MatchSnippet['field'],
    text: string | null | undefined,
    query: string,
    tokens: string[]
): MatchSnippet | null {
    if (!text) return null;
    const result = extractSnippet(text, query, tokens);
    if (!result) return null;
    return { field, ...result };
}

// ── Deep search helpers ─────────────────────────────────────────────

interface DeepMatch {
    adopterId: string;
    matchedText: string;
}

async function searchHistoryMatches(db: any, tokens: string[]): Promise<DeepMatch[]> {
    try {
        const conditions = tokens.map(t => like(adopterHistory.changes, `%${escapeLike(t)}%`));
        const logs = await db.select({
            adopterId: adopterHistory.adopterId,
            changes: adopterHistory.changes,
        })
            .from(adopterHistory)
            .where(conditions.length === 1 ? conditions[0] : or(...conditions))
            .limit(SEARCH_RESULT_LIMIT);
        return logs.map((l: any) => ({
            adopterId: l.adopterId,
            matchedText: l.changes || '',
        }));
    } catch (e) {
        logger.warn('History search error', { error: e instanceof Error ? e.message : String(e) });
        return [];
    }
}

async function searchAdoptionMatches(db: any, tokens: string[]): Promise<DeepMatch[]> {
    try {
        const conditions = tokens.flatMap(t => [
            like(adoptions.animalName, `%${escapeLike(t)}%`),
            like(adoptions.details, `%${escapeLike(t)}%`),
        ]);
        const adoptionLogs = await db.select({
            adopterId: adoptions.adopterId,
            animalName: adoptions.animalName,
            details: adoptions.details,
        })
            .from(adoptions)
            .where(conditions.length === 1 ? conditions[0] : or(...conditions))
            .limit(SEARCH_RESULT_LIMIT);
        return adoptionLogs.map((l: any) => {
            const nameMatches = countTokenMatches(l.animalName, tokens);
            const detailMatches = countTokenMatches(l.details, tokens);
            const matchedText = nameMatches >= detailMatches ? (l.animalName || '') : (l.details || '');
            return { adopterId: l.adopterId, matchedText };
        });
    } catch (e) {
        logger.warn('Adoption search error', { error: e instanceof Error ? e.message : String(e) });
        return [];
    }
}

// ── Relevance scoring ───────────────────────────────────────────────

const WEIGHTS = {
    name_exact: 100,
    name_contains: 50,
    name_tokens: 35,
    name_partial: 20,
    contact: 40,
    contact_partial: 25,
    address: 25,
    address_partial: 15,
    family: 20,
    family_partial: 12,
    adoption: 15,
    history: 10,
    query_coverage_full: 40,
    has_thumbnail: 5,
    has_rating: 3,
    verified: 2,
    recent_update: 3,
} as const;

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

// ── Build SQL conditions ────────────────────────────────────────────

function buildProfileSearchConditions(tokens: string[]) {
    const searchableFields = [adopters.name, adopters.contactInfo, adopters.addressInfo, adopters.familyMembers];

    if (tokens.length === 1) {
        return or(...searchableFields.map(f => like(f, `%${escapeLike(tokens[0])}%`)));
    }

    const tokenConditions = tokens.flatMap(token =>
        searchableFields.map(f => like(f, `%${escapeLike(token)}%`))
    );
    return or(...tokenConditions);
}

// ── Main search ─────────────────────────────────────────────────────

export async function searchAdopter(query: string): Promise<SearchResponse> {
    let user = 'unknown';
    try {
        const db = await getDb();
        try { user = await getUser(); } catch { /* unauthenticated */ }
        if (!db) return { results: [] };

        const normalizedQuery = query.trim();
        if (!normalizedQuery) return { results: [] };

        const isUnauthenticated = user === 'unknown';

        if (isPhoneLikeQuery(normalizedQuery) && countDigits(normalizedQuery) < MIN_PHONE_DIGITS) {
            return { results: [], validationError: 'min_digits' };
        }

        // Anti-fishing threshold: block raw PII guesses without session
        if (isUnauthenticated) {
            if (normalizedQuery.includes('@') || (isPhoneLikeQuery(normalizedQuery) && countDigits(normalizedQuery) >= MIN_PHONE_DIGITS)) {
                return { results: [], validationError: 'login_required' };
            }
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

        // Log search (fire and forget)
        (async () => {
            try {
                await db.insert(searches).values({
                    id: crypto.randomUUID(),
                    query: normalizedQuery,
                    type: "general",
                    count: 1,
                    lastSearchedAt: new Date(),
                }).onConflictDoUpdate({
                    target: searches.query,
                    set: { count: sql`count + 1`, lastSearchedAt: new Date() }
                });
            } catch (e) { logger.warn('Failed to log search query', { error: e instanceof Error ? e.message : String(e) }); }
        })();

        // 1. Profile search + 2. Parallel deep search
        const profileConditions: any[] = [
            isNull(adopters.deletedAt),
            buildProfileSearchConditions(tokens),
        ];
        if (userCountry) profileConditions.push(eq(adopters.country, userCountry));

        const profileQuery = db.select().from(adopters).where(
            and(...profileConditions)
        ).limit(SEARCH_ENRICHMENT_LIMIT);

        const [directResults, historyMatches, adoptionMatches] = await Promise.all([
            profileQuery,
            searchHistoryMatches(db, tokens),
            searchAdoptionMatches(db, tokens)
        ]);

        // Build deep search lookup maps
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

        // Merge deep search IDs
        const extraIds = new Set([...historyIds, ...adoptionIds]);
        directResults.forEach((r: any) => extraIds.delete(r.id));

        let extraProfiles: typeof adopters.$inferSelect[] = [];
        if (extraIds.size > 0) {
            const extraConditions = [inArray(adopters.id, Array.from(extraIds))];
            if (userCountry) extraConditions.push(eq(adopters.country, userCountry));
            extraProfiles = await db.select().from(adopters).where(and(...extraConditions));
        }

        const allProfiles = [...directResults, ...extraProfiles];
        const adopterIds = allProfiles.map(a => a.id);
        if (adopterIds.length === 0) return { results: [] };

        const enrichmentMap = await enrichAdopters(db, adopterIds);

        // Log search hits (fire and forget)
        (async () => {
            try {
                for (const a of allProfiles) {
                    await db.insert(adopterStats).values({
                        id: crypto.randomUUID(),
                        adopterId: a.id,
                        eventType: 'search_hit',
                        userId: user,
                        createdAt: new Date()
                    });
                }
            } catch (e) { logger.warn('Failed to log search hits', { error: e instanceof Error ? e.message : String(e) }); }
        })();

        // ── Score & snippet each result ──────────────────────────
        const qLower = normalizedQuery.toLowerCase();

        const allResults = allProfiles.map(a => {
            const enrichment = enrichmentMap.get(a.id);
            let score = 0;
            let bestSnippet: MatchSnippet | null = null;
            let bestSnippetWeight = 0;

            // ── Name ─────────────────────────────────────────────
            const nameLower = a.name?.toLowerCase() || '';
            if (nameLower === qLower) {
                score += WEIGHTS.name_exact;
                const s = buildSnippet('name', a.name, normalizedQuery, tokens);
                if (s && WEIGHTS.name_exact > bestSnippetWeight) { bestSnippet = s; bestSnippetWeight = WEIGHTS.name_exact; }
            } else if (nameLower.includes(qLower)) {
                score += WEIGHTS.name_contains;
                const s = buildSnippet('name', a.name, normalizedQuery, tokens);
                if (s && WEIGHTS.name_contains > bestSnippetWeight) { bestSnippet = s; bestSnippetWeight = WEIGHTS.name_contains; }
            } else if (isMultiToken && allTokensMatch(a.name, tokens)) {
                score += WEIGHTS.name_tokens;
                const s = buildSnippet('name', a.name, normalizedQuery, tokens);
                if (s && WEIGHTS.name_tokens > bestSnippetWeight) { bestSnippet = s; bestSnippetWeight = WEIGHTS.name_tokens; }
            } else if (isMultiToken && anyTokenMatch(a.name, tokens)) {
                const matched = countTokenMatches(a.name, tokens);
                score += Math.round(WEIGHTS.name_partial * (matched / tokens.length));
                const s = buildSnippet('name', a.name, normalizedQuery, tokens);
                if (s && WEIGHTS.name_partial > bestSnippetWeight) { bestSnippet = s; bestSnippetWeight = WEIGHTS.name_partial; }
            }

            // ── Contact ──────────────────────────────────────────
            if (a.contactInfo?.toLowerCase().includes(qLower)) {
                score += WEIGHTS.contact;
                const s = buildSnippet('contact', a.contactInfo, normalizedQuery, tokens);
                if (s && WEIGHTS.contact > bestSnippetWeight) { bestSnippet = s; bestSnippetWeight = WEIGHTS.contact; }
            } else if (isMultiToken && anyTokenMatch(a.contactInfo, tokens)) {
                const matched = countTokenMatches(a.contactInfo, tokens);
                score += Math.round(WEIGHTS.contact_partial * (matched / tokens.length));
                const s = buildSnippet('contact', a.contactInfo, normalizedQuery, tokens);
                if (s && WEIGHTS.contact_partial > bestSnippetWeight) { bestSnippet = s; bestSnippetWeight = WEIGHTS.contact_partial; }
            }

            // ── Address ──────────────────────────────────────────
            if (a.addressInfo?.toLowerCase().includes(qLower)) {
                score += WEIGHTS.address;
                const s = buildSnippet('address', a.addressInfo, normalizedQuery, tokens);
                if (s && WEIGHTS.address > bestSnippetWeight) { bestSnippet = s; bestSnippetWeight = WEIGHTS.address; }
            } else if (isMultiToken && anyTokenMatch(a.addressInfo, tokens)) {
                const matched = countTokenMatches(a.addressInfo, tokens);
                score += Math.round(WEIGHTS.address_partial * (matched / tokens.length));
                const s = buildSnippet('address', a.addressInfo, normalizedQuery, tokens);
                if (s && WEIGHTS.address_partial > bestSnippetWeight) { bestSnippet = s; bestSnippetWeight = WEIGHTS.address_partial; }
            }

            // ── Family ───────────────────────────────────────────
            if (a.familyMembers?.toLowerCase().includes(qLower)) {
                score += WEIGHTS.family;
                const s = buildSnippet('family', a.familyMembers, normalizedQuery, tokens);
                if (s && WEIGHTS.family > bestSnippetWeight) { bestSnippet = s; bestSnippetWeight = WEIGHTS.family; }
            } else if (isMultiToken && anyTokenMatch(a.familyMembers, tokens)) {
                const matched = countTokenMatches(a.familyMembers, tokens);
                score += Math.round(WEIGHTS.family_partial * (matched / tokens.length));
                const s = buildSnippet('family', a.familyMembers, normalizedQuery, tokens);
                if (s && WEIGHTS.family_partial > bestSnippetWeight) { bestSnippet = s; bestSnippetWeight = WEIGHTS.family_partial; }
            }

            // ── Adoption deep search ─────────────────────────────
            if (adoptionIds.includes(a.id)) {
                score += WEIGHTS.adoption;
                const matchedText = adoptionTextMap.get(a.id);
                if (matchedText && WEIGHTS.adoption > bestSnippetWeight) {
                    const s = buildSnippet('adoption', matchedText, normalizedQuery, tokens);
                    if (s) { bestSnippet = s; bestSnippetWeight = WEIGHTS.adoption; }
                }
            }

            // ── History deep search ──────────────────────────────
            if (historyIds.includes(a.id)) {
                score += WEIGHTS.history;
                if (WEIGHTS.history > bestSnippetWeight) {
                    bestSnippet = { field: 'history', snippet: '', highlights: [] };
                    bestSnippetWeight = WEIGHTS.history;
                }
            }

            // ── Cross-field coverage bonus ────────────────────────
            if (isMultiToken) {
                const allSearchableText = [
                    a.name, a.contactInfo, a.addressInfo, a.familyMembers,
                    adoptionTextMap.get(a.id), historyTextMap.get(a.id)
                ].filter(Boolean).join(' ');
                const coveredTokens = countTokenMatches(allSearchableText, tokens);
                const coverage = coveredTokens / tokens.length;
                if (coverage >= 1) {
                    score += WEIGHTS.query_coverage_full;
                } else {
                    score += Math.round(WEIGHTS.query_coverage_full * coverage * 0.5);
                }
            }

            // ── Bonus signals ────────────────────────────────────
            if (enrichment?.thumbnail) score += WEIGHTS.has_thumbnail;
            if (enrichment?.avgRating != null) score += WEIGHTS.has_rating;
            if (enrichment?.flags.verified_identity) score += WEIGHTS.verified;
            if (a.updatedAt) {
                const updatedMs = typeof a.updatedAt === 'number'
                    ? a.updatedAt * 1000
                    : new Date(a.updatedAt).getTime();
                if (Date.now() - updatedMs < NINETY_DAYS_MS) score += WEIGHTS.recent_update;
            }

            const isUnauthenticated = user === 'unknown';
            const result = {
                adopter: { ...a },
                matchSnippet: bestSnippet ? { ...bestSnippet } : null,
                relevanceScore: score,
                avgRating: enrichment?.avgRating ?? null,
                thumbnail: enrichment?.thumbnail ?? null,
                stats: enrichment?.stats ?? { searchHits: 0, profileViews: 0, requests: 0, adoptions: 0 },
                flags: enrichment?.flags ?? {
                    inaccurate: false, duplicate: false, systemDuplicate: false,
                    verified_identity: false, verified_address: false,
                    tooManyAdoptions: null, tooManyRequests: null
                }
            };

            if (isUnauthenticated) {
                // mask name
                result.adopter.name = result.adopter.name?.length > 3 ? result.adopter.name.slice(0, 3) + '••••' : '••••';
                // mask contact
                result.adopter.contactInfo = result.adopter.contactInfo
                    ?.replace(/(\d{2,3})[\d\s\-.()]{4,}/g, '$1••••••')
                    ?.replace(/[a-zA-Z0-9._%+-]+@/g, '•••@') || null;
                
                // clear sensitive fields entirely
                result.adopter.familyMembers = null;
                result.adopter.addressInfo = null;
                
                // Suppress raw snippet payload
                if (result.matchSnippet) {
                    result.matchSnippet.snippet = "";
                    result.matchSnippet.highlights = [];
                }
            }

            return result;
        });

        allResults.sort((a, b) => b.relevanceScore - a.relevanceScore);

        const totalCount = allResults.length;
        logger.info('Search', { query, tokens: tokens.length, resultCount: Math.min(totalCount, SEARCH_RESULT_LIMIT), truncated: totalCount > SEARCH_RESULT_LIMIT, user });
        logAudit({ userEmail: user, action: 'search', details: { query, resultCount: Math.min(totalCount, SEARCH_RESULT_LIMIT) } });

        if (totalCount > SEARCH_RESULT_LIMIT) {
            return { results: allResults.slice(0, SEARCH_RESULT_LIMIT), truncated: true, totalCount };
        }

        return { results: allResults };

    } catch (error) {
        const errorId = logger.error('Search failed', error, { query, user });
        throw new Error(`Search failed (ID: ${errorId})`);
    }
}
