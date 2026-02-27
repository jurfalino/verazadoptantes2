'use server';

import { adopters, searches, adopterHistory, adoptions, adopterStats } from '@/db/schema';
import { or, like, sql, and, isNull, inArray, eq } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { getDb, getUser } from './_db';
import { SEARCH_RESULT_LIMIT, SEARCH_ENRICHMENT_LIMIT } from '@/config/constants';
import type { SearchResponse } from './types';
import { enrichAdopters } from './enrichAdopters';
import { searchSchema } from './validation';

const MIN_PHONE_DIGITS = 4;

// Helper to detect if query looks like a phone number
function isPhoneLikeQuery(query: string): boolean {
    // Remove common phone separators and check if mostly digits
    const digitsOnly = query.replace(/[\s\-\.\(\)\+]/g, '');
    // If more than 50% of remaining chars are digits, treat as phone-like
    const digitCount = (digitsOnly.match(/\d/g) || []).length;
    return digitCount > 0 && digitCount / digitsOnly.length > 0.5;
}

function countDigits(query: string): number {
    return (query.match(/\d/g) || []).length;
}

// Helper to perform parallel searches
async function searchHistoryIds(db: any, query: string): Promise<string[]> {
    try {
        const logs = await db.select({ adopterId: adopterHistory.adopterId })
            .from(adopterHistory)
            .where(like(adopterHistory.changes, `%${query}%`))
            .limit(SEARCH_RESULT_LIMIT);
        return logs.map((l: any) => l.adopterId);
    } catch (e) {
        console.error("History search error", e);
        return [];
    }
}

async function searchAdoptionsIds(db: any, query: string): Promise<string[]> {
    try {
        const adoptionLogs = await db.select({ adopterId: adoptions.adopterId })
            .from(adoptions)
            .where(or(
                like(adoptions.animalName, `%${query}%`),
                like(adoptions.details, `%${query}%`)
            ))
            .limit(SEARCH_RESULT_LIMIT);
        return adoptionLogs.map((l: any) => l.adopterId);
    } catch (e) {
        console.error("Adoption search error", e);
        return [];
    }
}

export async function searchAdopter(query: string): Promise<SearchResponse> {
    // Validate input
    const parsed = searchSchema.safeParse({ query });
    if (!parsed.success) {
        return { results: [], validationError: 'invalid_query' };
    }

    let user = 'unknown';
    try {
        const db = await getDb();
        user = await getUser();
        if (!db) return { results: [] };

        // Normalize query
        const normalizedQuery = query.trim();
        if (!normalizedQuery) return { results: [] };

        // Validate phone-like queries have minimum digits
        if (isPhoneLikeQuery(normalizedQuery) && countDigits(normalizedQuery) < MIN_PHONE_DIGITS) {
            return { results: [], validationError: 'min_digits' };
        }

        // Look up current user's country for geo-filtering
        let userCountry: string | null = null;
        try {
            const { env } = (await import('@cloudflare/next-on-pages')).getRequestContext();
            if (env?.DB) {
                const row = await env.DB.prepare(
                    `SELECT up.country FROM user_profiles up JOIN user u ON u.id = up.user_id WHERE u.email = ? LIMIT 1`
                ).bind(user).first<{ country: string | null }>();
                userCountry = row?.country || null;
            }
        } catch { /* country lookup is best-effort */ }

        // Log the search (fire and forget)
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
                    set: {
                        count: sql`count + 1`,
                        lastSearchedAt: new Date()
                    }
                });
            } catch (e) { logger.warn('Failed to log search query', { error: e instanceof Error ? e.message : String(e) }); }
        })();

        // 1. Search Main Profile (Name, Contact, Address, Family)
        const profileConditions = [
            isNull(adopters.deletedAt),
            or(
                like(adopters.name, `%${normalizedQuery}%`),
                like(adopters.contactInfo, `%${normalizedQuery}%`),
                like(adopters.familyMembers, `%${normalizedQuery}%`)
            )
        ];
        // Apply country filter if user has a country set
        if (userCountry) {
            profileConditions.push(eq(adopters.country, userCountry));
        }
        const profileQuery = db.select().from(adopters).where(
            and(...profileConditions)
        ).limit(SEARCH_ENRICHMENT_LIMIT);

        // 2. Parallel Deep Search (History & Adoptions)
        const [directResults, historyIds, adoptionIds] = await Promise.all([
            profileQuery,
            searchHistoryIds(db, normalizedQuery),
            searchAdoptionsIds(db, normalizedQuery)
        ]);

        // Merge IDs unique
        const extraIds = new Set([...historyIds, ...adoptionIds]);

        // Remove IDs already found in directResults
        directResults.forEach((r: any) => extraIds.delete(r.id));

        // Fetch profiles for extra IDs
        let extraProfiles: typeof adopters.$inferSelect[] = [];
        if (extraIds.size > 0) {
            const extraConditions = [inArray(adopters.id, Array.from(extraIds))];
            if (userCountry) {
                extraConditions.push(eq(adopters.country, userCountry));
            }
            extraProfiles = await db.select().from(adopters)
                .where(and(...extraConditions));
        }

        // Combine Results
        const allProfiles = [...directResults, ...extraProfiles];
        const adopterIds = allProfiles.map(a => a.id);

        if (adopterIds.length === 0) return { results: [] };

        // Enrich all adopters with ratings, stats, flags, and thumbnails
        const enrichmentMap = await enrichAdopters(db, adopterIds);

        // Log search hits for each result (fire and forget)
        (async () => {
            try {
                for (const a of allProfiles) {
                    await db.insert(adopterStats).values({
                        id: crypto.randomUUID(),
                        adopterId: a.id,
                        eventType: 'search_hit',
                        createdAt: new Date()
                    });
                }
            } catch (e) { console.error("Failed to log search hits", e); }
        })();

        // Map to enriched result type
        const allResults = allProfiles.map(a => {
            // Determine match context
            let context = "";
            const qLower = normalizedQuery.toLowerCase();

            const basicMatch =
                (a.name?.toLowerCase().includes(qLower)) ||
                (a.contactInfo?.toLowerCase().includes(qLower));

            if (!basicMatch) {
                if (a.familyMembers?.toLowerCase().includes(qLower)) {
                    context = "match_family";
                } else if (historyIds.includes(a.id)) {
                    context = "match_history";
                } else if (adoptionIds.includes(a.id)) {
                    context = "match_adoption";
                }
            }

            const enrichment = enrichmentMap.get(a.id);

            return {
                adopter: a,
                matchContext: context,
                avgRating: enrichment?.avgRating ?? null,
                thumbnail: enrichment?.thumbnail ?? null,
                stats: enrichment?.stats ?? { searchHits: 0, profileViews: 0, requests: 0, adoptions: 0 },
                flags: enrichment?.flags ?? {
                    inaccurate: false, duplicate: false, systemDuplicate: false,
                    verified_identity: false, verified_address: false,
                    tooManyAdoptions: null, tooManyRequests: null
                }
            };
        });

        // Apply result cap
        const totalCount = allResults.length;

        // Log search hit
        logger.info('Search', { query, resultCount: Math.min(totalCount, SEARCH_RESULT_LIMIT), truncated: totalCount > SEARCH_RESULT_LIMIT, user });
        logAudit({ userEmail: user, action: 'search', details: { query, resultCount: Math.min(totalCount, SEARCH_RESULT_LIMIT) } });

        if (totalCount > SEARCH_RESULT_LIMIT) {
            return {
                results: allResults.slice(0, SEARCH_RESULT_LIMIT),
                truncated: true,
                totalCount
            };
        }

        return { results: allResults };

    } catch (error) {
        const errorId = logger.error('Search failed', error, { query, user });
        throw new Error(`Search failed (ID: ${errorId})`);
    }
}
