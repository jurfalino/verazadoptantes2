'use server';

import { adopters, searches, adopterHistory, adoptions, adopterImages, adopterFlags, adopterStats, duplicateCandidates } from '@/db/schema';
import { or, like, eq, sql, and, isNull, inArray, ne } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { getDb, getUser } from './_db';
import { getAdoptionConfig } from './config';
import { SEARCH_RESULT_LIMIT, SEARCH_ENRICHMENT_LIMIT } from '@/config/constants';
import type { AdopterFlags, SearchResponse } from './types';

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
        // Search in history for JSON changes containing the query
        // Note: 'like' on text column is expensive but necessary for this requirement
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
        const profileQuery = db.select().from(adopters).where(
            and(
                isNull(adopters.deletedAt),
                or(
                    like(adopters.name, `%${normalizedQuery}%`),
                    like(adopters.contactInfo, `%${normalizedQuery}%`),
                    like(adopters.familyMembers, `%${normalizedQuery}%`)
                )
            )
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
            extraProfiles = await db.select().from(adopters)
                .where(inArray(adopters.id, Array.from(extraIds)));
        }

        // Combine Results
        const allProfiles = [...directResults, ...extraProfiles];
        const adopterIds = allProfiles.map(a => a.id);

        if (adopterIds.length === 0) return { results: [] };

        // Fetch enrichment data per adopter (D1 doesn't handle IN with arrays well)
        const adoptionConfig = await getAdoptionConfig();

        // Initialize maps for enrichment data
        const adoptionMap = new Map<string, { avgRating: number | null; count: number; adoptionCount: number; requestCount: number }>();
        const flagsMap = new Map<string, AdopterFlags>();
        const statsMap = new Map<string, { searchHits: number; profileViews: number; requests: number; adoptions: number }>();
        const thumbnailMap = new Map<string, string>();
        const allAdoptionRecords: { adopterId: string; recordType: string | null; date: number | null }[] = [];

        // Fetch data for each adopter in parallel (D1 compatible - uses eq() not inArray())
        await Promise.all(allProfiles.map(async (adopter) => {
            const adopterId = adopter.id;

            // Run all 4 enrichment queries in parallel for this adopter
            const [adopterAdoptions, adopterFlagRecords, adopterStatRecords, adopterImagesResult, systemDupCount] = await Promise.all([
                // Adoptions
                db.select({
                    rating: adoptions.rating,
                    recordType: adoptions.recordType,
                    date: adoptions.date
                }).from(adoptions).where(eq(adoptions.adopterId, adopterId)).catch(() => []),

                // Flags
                db.select({ reason: adopterFlags.reason })
                    .from(adopterFlags)
                    .where(eq(adopterFlags.adopterId, adopterId)).catch(() => []),

                // Stats
                db.select({ eventType: adopterStats.eventType })
                    .from(adopterStats)
                    .where(eq(adopterStats.adopterId, adopterId)).catch(() => []),

                // Images
                db.select({
                    url: adopterImages.url,
                    isProfilePicture: adopterImages.isProfilePicture
                })
                    .from(adopterImages)
                    .where(and(
                        eq(adopterImages.adopterId, adopterId),
                        isNull(adopterImages.adoptionId)
                    ))
                    .orderBy(sql`${adopterImages.isProfilePicture} DESC, ${adopterImages.uploadedAt} DESC`)
                    .limit(1).catch(() => []),

                // System-detected duplicates (medium/high confidence only)
                db.select({ count: sql<number>`COUNT(*)` })
                    .from(duplicateCandidates)
                    .where(and(
                        eq(duplicateCandidates.status, 'pending'),
                        ne(duplicateCandidates.confidence, 'low'),
                        or(
                            eq(duplicateCandidates.adopter1Id, adopterId),
                            eq(duplicateCandidates.adopter2Id, adopterId),
                        ),
                    )).catch(() => [{ count: 0 }])
            ]);

            // Process adoptions
            if (adopterAdoptions.length > 0) {
                const avgRating = adopterAdoptions.reduce((sum: number, a: { rating: number | null }) => sum + (a.rating || 0), 0) / adopterAdoptions.length;
                const adoptionCount = adopterAdoptions.filter((a: { recordType: string | null }) => a.recordType === 'adoption').length;
                const requestCount = adopterAdoptions.filter((a: { recordType: string | null }) => a.recordType === 'adoption_request').length;
                adoptionMap.set(adopterId, { avgRating, count: adopterAdoptions.length, adoptionCount, requestCount });
                for (const rec of adopterAdoptions) {
                    allAdoptionRecords.push({ adopterId, recordType: rec.recordType, date: rec.date });
                }
            }

            // Process flags
            const flags: AdopterFlags = {
                inaccurate: false,
                duplicate: false,
                systemDuplicate: (systemDupCount[0]?.count ?? 0) > 0,
                verified_identity: false,
                verified_address: false,
                tooManyAdoptions: null,
                tooManyRequests: null
            };
            for (const f of adopterFlagRecords) {
                if (f.reason === 'inaccurate') flags.inaccurate = true;
                if (f.reason === 'duplicate') flags.duplicate = true;
                if (f.reason === 'verified_identity') flags.verified_identity = true;
                if (f.reason === 'verified_address') flags.verified_address = true;
            }
            flagsMap.set(adopterId, flags);

            // Process stats (only search_hit and profile_view — adoption/request counts come from adoptionMap)
            const stats = { searchHits: 0, profileViews: 0, requests: 0, adoptions: 0 };
            for (const s of adopterStatRecords) {
                if (s.eventType === 'search_hit') stats.searchHits++;
                else if (s.eventType === 'profile_view') stats.profileViews++;
            }
            statsMap.set(adopterId, stats);

            // Process thumbnail
            if (adopterImagesResult.length > 0) {
                thumbnailMap.set(adopterId, adopterImagesResult[0].url);
            }
        }));

        // Process adoption records for tooMany flags
        const periodCutoff = Date.now() - (adoptionConfig.periodDays * 24 * 60 * 60 * 1000);
        for (const rec of allAdoptionRecords) {
            if (!rec.date || rec.date < periodCutoff) continue;
            const flags = flagsMap.get(rec.adopterId) || {
                inaccurate: false, duplicate: false, systemDuplicate: false, verified_identity: false, verified_address: false,
                tooManyAdoptions: null, tooManyRequests: null
            };
            if (rec.recordType === 'adoption') {
                if (!flags.tooManyAdoptions) {
                    flags.tooManyAdoptions = { count: 0, threshold: adoptionConfig.threshold, periodDays: adoptionConfig.periodDays };
                }
                flags.tooManyAdoptions.count++;
            } else if (rec.recordType === 'request') {
                if (!flags.tooManyRequests) {
                    flags.tooManyRequests = { count: 0, threshold: adoptionConfig.requestsThreshold, periodDays: adoptionConfig.requestsPeriodDays };
                }
                flags.tooManyRequests.count++;
            }
            flagsMap.set(rec.adopterId, flags);
        }

        // Clear tooMany flags if below threshold
        for (const [_adopterId, flags] of flagsMap) {
            if (flags.tooManyAdoptions && flags.tooManyAdoptions.count < flags.tooManyAdoptions.threshold) {
                flags.tooManyAdoptions = null;
            }
            if (flags.tooManyRequests && flags.tooManyRequests.count < flags.tooManyRequests.threshold) {
                flags.tooManyRequests = null;
            }
        }

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
                    context = "Matches family members";
                } else if (historyIds.includes(a.id)) {
                    context = "Matches history log";
                } else if (adoptionIds.includes(a.id)) {
                    context = "Matches adoption records";
                }
            }

            const adoptionData = adoptionMap.get(a.id);
            const defaultFlags: AdopterFlags = {
                inaccurate: false,
                duplicate: false,
                systemDuplicate: false,
                verified_identity: false,
                verified_address: false,
                tooManyAdoptions: null,
                tooManyRequests: null
            };
            const flagData = flagsMap.get(a.id) || defaultFlags;
            const statData = statsMap.get(a.id) || { searchHits: 0, profileViews: 0, requests: 0, adoptions: 0 };
            const thumbnail = thumbnailMap.get(a.id) || null;

            // Use real counts from adoptions table, not empty analytics events
            statData.adoptions = adoptionData?.adoptionCount ?? 0;
            statData.requests = adoptionData?.requestCount ?? 0;

            return {
                adopter: a,
                matchContext: context,
                avgRating: adoptionData?.avgRating ?? null,
                thumbnail,
                stats: statData,
                flags: flagData
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
