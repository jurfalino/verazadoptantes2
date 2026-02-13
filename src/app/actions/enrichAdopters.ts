import { adoptions, adopterFlags, adopterStats, adopterImages, duplicateCandidates } from '@/db/schema';
import { eq, sql, and, isNull, ne, or } from 'drizzle-orm';
import type { AdopterFlags } from './types';
import { getAdoptionConfig } from './config';

export interface EnrichmentResult {
    avgRating: number | null;
    thumbnail: string | null;
    stats: { searchHits: number; profileViews: number; requests: number; adoptions: number };
    flags: AdopterFlags;
}

/**
 * Enrich a list of adopter profiles with ratings, stats, flags, and thumbnails.
 * Used by both the search action and the admin adopters page.
 */
export async function enrichAdopters(
    db: any,
    adopterIds: string[]
): Promise<Map<string, EnrichmentResult>> {
    if (adopterIds.length === 0) return new Map();

    const adoptionConfig = await getAdoptionConfig();

    // Initialize maps for enrichment data
    const adoptionMap = new Map<string, { avgRating: number | null; count: number; adoptionCount: number; requestCount: number }>();
    const flagsMap = new Map<string, AdopterFlags>();
    const statsMap = new Map<string, { searchHits: number; profileViews: number; requests: number; adoptions: number }>();
    const thumbnailMap = new Map<string, string>();
    const allAdoptionRecords: { adopterId: string; recordType: string | null; date: number | null }[] = [];

    // Fetch data for each adopter in parallel (D1 compatible - uses eq() not inArray())
    await Promise.all(adopterIds.map(async (adopterId) => {
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
    for (const [, flags] of flagsMap) {
        if (flags.tooManyAdoptions && flags.tooManyAdoptions.count < flags.tooManyAdoptions.threshold) {
            flags.tooManyAdoptions = null;
        }
        if (flags.tooManyRequests && flags.tooManyRequests.count < flags.tooManyRequests.threshold) {
            flags.tooManyRequests = null;
        }
    }

    // Build combined result map
    const resultMap = new Map<string, EnrichmentResult>();
    const defaultFlags: AdopterFlags = {
        inaccurate: false, duplicate: false, systemDuplicate: false,
        verified_identity: false, verified_address: false,
        tooManyAdoptions: null, tooManyRequests: null
    };

    for (const id of adopterIds) {
        const adoptionData = adoptionMap.get(id);
        const statData = statsMap.get(id) || { searchHits: 0, profileViews: 0, requests: 0, adoptions: 0 };

        // Use real counts from adoptions table
        statData.adoptions = adoptionData?.adoptionCount ?? 0;
        statData.requests = adoptionData?.requestCount ?? 0;

        resultMap.set(id, {
            avgRating: adoptionData?.avgRating ?? null,
            thumbnail: thumbnailMap.get(id) || null,
            stats: statData,
            flags: flagsMap.get(id) || defaultFlags,
        });
    }

    return resultMap;
}
