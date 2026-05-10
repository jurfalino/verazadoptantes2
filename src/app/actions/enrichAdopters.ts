'use server';

import { adoptions, adopterFlags, adopterStats, adopterImages, duplicateCandidates } from '@/db/schema';
import { eq, sql, and, isNull, ne, or } from 'drizzle-orm';
import { ADMIN_STATS_EXCLUSION_SQL } from '@/config/constants';
import type { AdopterFlags } from '@/types/adopter';
import { getAdoptionConfig } from './config';

import { computeAvgRating } from '@/domain/ratings';
import { computeStats } from '@/domain/stats';
import { buildFlags } from '@/domain/flags';
import { RECORD_TYPES } from '@/domain/constants';
import { computeMaxDensityPeriod } from '@/lib/adoptionFilters';
import { logger, withTrace } from '@/lib/logger';

const logD1Fallback = (op: string, adopterId: string) => (e: unknown) => {
    logger.warn('enrichAdopters: D1 fallback hit', {
        op,
        adopterId,
        error: e instanceof Error ? e.message : String(e),
    });
    return [];
};

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
    return withTrace('enrichAdopters', () => _enrichAdoptersImpl(db, adopterIds), { count: adopterIds.length });
}

async function _enrichAdoptersImpl(
    db: any,
    adopterIds: string[]
): Promise<Map<string, EnrichmentResult>> {
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
            }).from(adoptions).where(eq(adoptions.adopterId, adopterId)).catch(logD1Fallback('adoptions', adopterId)),

            // Flags
            db.select({ reason: adopterFlags.reason })
                .from(adopterFlags)
                .where(eq(adopterFlags.adopterId, adopterId)).catch(logD1Fallback('flags', adopterId)),

            // Stats (exclude admin activity)
            db.select({ eventType: adopterStats.eventType })
                .from(adopterStats)
                .where(and(
                    eq(adopterStats.adopterId, adopterId),
                    sql`(${adopterStats.userId} IS NULL OR ${adopterStats.userId} NOT IN (${sql.raw(ADMIN_STATS_EXCLUSION_SQL)}))`
                )).catch(logD1Fallback('stats', adopterId)),

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
                .limit(1).catch(logD1Fallback('images', adopterId)),

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
            const avgRating = computeAvgRating(adopterAdoptions);
            const adoptionCount = adopterAdoptions.filter((a: { recordType: string | null }) => a.recordType === RECORD_TYPES.ADOPTION).length;
            const requestCount = adopterAdoptions.filter((a: { recordType: string | null }) => a.recordType === RECORD_TYPES.REQUEST).length;
            adoptionMap.set(adopterId, { avgRating, count: adopterAdoptions.length, adoptionCount, requestCount });
            for (const rec of adopterAdoptions) {
                allAdoptionRecords.push({ adopterId, recordType: rec.recordType, date: rec.date });
            }
        }

        // Process flags (using domain function — fixes 'inaccurate' vs 'inaccurate_information' mismatch)
        const flagReasons = adopterFlagRecords.map((f: { reason: string }) => f.reason);
        const flags = buildFlags(flagReasons, systemDupCount[0]?.count ?? 0);
        flagsMap.set(adopterId, flags);

        // Process stats (using domain function)
        const stats = computeStats(adopterStatRecords, adopterAdoptions);
        statsMap.set(adopterId, stats);

        // Process thumbnail
        if (adopterImagesResult.length > 0) {
            thumbnailMap.set(adopterId, adopterImagesResult[0].url);
        }
    }));

    // Group adoptions by adopterId
    const recordsByAdopterId = new Map<string, any[]>();
    for (const rec of allAdoptionRecords) {
        if (!recordsByAdopterId.has(rec.adopterId)) {
            recordsByAdopterId.set(rec.adopterId, []);
        }
        recordsByAdopterId.get(rec.adopterId)!.push(rec);
    }

    for (const [adopterId, records] of recordsByAdopterId) {
        const flags = flagsMap.get(adopterId) || {
            inaccurate: false, duplicate: false, systemDuplicate: false, verified_identity: false, verified_address: false,
            tooManyAdoptions: null, tooManyRequests: null
        };
        
        const adoptionsDensity = computeMaxDensityPeriod(records as any, RECORD_TYPES.ADOPTION, adoptionConfig.periodDays);
        if (adoptionsDensity.count >= adoptionConfig.threshold) {
            flags.tooManyAdoptions = {
                count: adoptionsDensity.count,
                threshold: adoptionConfig.threshold,
                periodDays: adoptionConfig.periodDays,
                actualSpanDays: adoptionsDensity.timeSpanDays,
                startDate: adoptionsDensity.startDate,
                endDate: adoptionsDensity.endDate
            };
        }

        const requestsDensity = computeMaxDensityPeriod(records as any, RECORD_TYPES.REQUEST, adoptionConfig.requestsPeriodDays);
        if (requestsDensity.count >= adoptionConfig.requestsThreshold) {
            flags.tooManyRequests = {
                count: requestsDensity.count,
                threshold: adoptionConfig.requestsThreshold,
                periodDays: adoptionConfig.requestsPeriodDays,
                actualSpanDays: requestsDensity.timeSpanDays,
                startDate: requestsDensity.startDate,
                endDate: requestsDensity.endDate
            };
        }

        flagsMap.set(adopterId, flags);
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
