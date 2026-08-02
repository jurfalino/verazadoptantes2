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

// v2.20.0: batch-query fallback (per chunk, not per adopter). Returns [] so the
// chunk degrades to "no data" for that table rather than throwing the whole list.
const logBatchFallback = (op: string, chunkSize: number) => (e: unknown) => {
    logger.warn('enrichAdopters: D1 batch fallback hit', {
        op,
        chunkSize,
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

    // v2.20.0: batch the enrichment into a handful of grouped queries instead of
    // 5 queries PER adopter (~5×N — up to ~1000 D1 subrequests at 200 rows, the
    // Error-1102 class). D1-safe IN(?, ?, …) via sql.join (each id is its own
    // bound param — NOT drizzle inArray(), which mis-binds on D1). Chunked to
    // stay under D1's per-query bound-parameter limit (the dup query uses the IN
    // list twice, so chunk*2 must stay within budget).
    const CHUNK = 40;
    type AdoptionRow = { adopterId: string; rating: number | null; recordType: string | null; date: number | null };
    type FlagRow = { adopterId: string; reason: string };
    type StatRow = { adopterId: string; eventType: string };
    type ImageRow = { adopterId: string; url: string; isProfilePicture: number | null };
    type DupRow = { adopter1Id: string; adopter2Id: string };

    const adoptionRows: AdoptionRow[] = [];
    const flagRows: FlagRow[] = [];
    const statRows: StatRow[] = [];
    const imageRows: ImageRow[] = [];
    const dupRows: DupRow[] = [];

    for (let i = 0; i < adopterIds.length; i += CHUNK) {
        const chunk = adopterIds.slice(i, i + CHUNK);
        const inList = sql.join(chunk.map((id) => sql`${id}`), sql`, `);
        const [a, f, s, im, d] = await Promise.all([
            db.select({ adopterId: adoptions.adopterId, rating: adoptions.rating, recordType: adoptions.recordType, date: adoptions.date })
                .from(adoptions).where(sql`${adoptions.adopterId} IN (${inList})`).catch(logBatchFallback('adoptions', chunk.length)),
            db.select({ adopterId: adopterFlags.adopterId, reason: adopterFlags.reason })
                .from(adopterFlags).where(sql`${adopterFlags.adopterId} IN (${inList})`).catch(logBatchFallback('flags', chunk.length)),
            db.select({ adopterId: adopterStats.adopterId, eventType: adopterStats.eventType })
                .from(adopterStats).where(and(
                    sql`${adopterStats.adopterId} IN (${inList})`,
                    sql`(${adopterStats.userId} IS NULL OR ${adopterStats.userId} NOT IN (${sql.raw(ADMIN_STATS_EXCLUSION_SQL)}))`
                )).catch(logBatchFallback('stats', chunk.length)),
            // Ordered so the first row per adopter is the chosen thumbnail.
            // v2.26.1: profile-level OR the flagged profile picture (an activity/
            // observation photo can be the avatar); isProfilePicture DESC wins.
            db.select({ adopterId: adopterImages.adopterId, url: adopterImages.url, isProfilePicture: adopterImages.isProfilePicture })
                .from(adopterImages).where(and(
                    sql`${adopterImages.adopterId} IN (${inList})`,
                    or(isNull(adopterImages.adoptionId), eq(adopterImages.isProfilePicture, 1))
                )).orderBy(sql`${adopterImages.adopterId}, ${adopterImages.isProfilePicture} DESC, ${adopterImages.uploadedAt} DESC`)
                .catch(logBatchFallback('images', chunk.length)),
            db.select({ adopter1Id: duplicateCandidates.adopter1Id, adopter2Id: duplicateCandidates.adopter2Id })
                .from(duplicateCandidates).where(and(
                    eq(duplicateCandidates.status, 'pending'),
                    ne(duplicateCandidates.confidence, 'low'),
                    sql`(${duplicateCandidates.adopter1Id} IN (${inList}) OR ${duplicateCandidates.adopter2Id} IN (${inList}))`
                )).catch(logBatchFallback('dupCandidates', chunk.length)),
        ]);
        adoptionRows.push(...(a as AdoptionRow[]));
        flagRows.push(...(f as FlagRow[]));
        statRows.push(...(s as StatRow[]));
        imageRows.push(...(im as ImageRow[]));
        dupRows.push(...(d as DupRow[]));
    }

    // Group rows by adopterId
    const groupBy = <T extends { adopterId: string }>(rows: T[]): Map<string, T[]> => {
        const m = new Map<string, T[]>();
        for (const r of rows) {
            const arr = m.get(r.adopterId);
            if (arr) arr.push(r); else m.set(r.adopterId, [r]);
        }
        return m;
    };
    const adoptionsByAdopter = groupBy(adoptionRows);
    const flagsByAdopter = groupBy(flagRows);
    const statsByAdopter = groupBy(statRows);
    // Images come pre-ordered; first seen per adopter is the chosen thumbnail.
    const thumbByAdopter = new Map<string, string>();
    for (const r of imageRows) if (!thumbByAdopter.has(r.adopterId)) thumbByAdopter.set(r.adopterId, r.url);
    // Each pending dup candidate counts toward both of its adopters (matches the
    // original per-adopter `adopter1Id = id OR adopter2Id = id` count).
    const dupCountByAdopter = new Map<string, number>();
    for (const r of dupRows) {
        dupCountByAdopter.set(r.adopter1Id, (dupCountByAdopter.get(r.adopter1Id) ?? 0) + 1);
        dupCountByAdopter.set(r.adopter2Id, (dupCountByAdopter.get(r.adopter2Id) ?? 0) + 1);
    }

    // Build result per adopter — domain logic unchanged, only the source differs.
    const resultMap = new Map<string, EnrichmentResult>();
    for (const id of adopterIds) {
        const adopterAdoptions = adoptionsByAdopter.get(id) ?? [];
        const adopterFlagRecords = flagsByAdopter.get(id) ?? [];
        const adopterStatRecords = statsByAdopter.get(id) ?? [];
        const systemDupCount = dupCountByAdopter.get(id) ?? 0;

        const avgRating = adopterAdoptions.length > 0 ? computeAvgRating(adopterAdoptions) : null;
        const adoptionCount = adopterAdoptions.filter((a) => a.recordType === RECORD_TYPES.ADOPTION).length;
        const requestCount = adopterAdoptions.filter((a) => a.recordType === RECORD_TYPES.REQUEST).length;

        const flags = buildFlags(adopterFlagRecords.map((fr) => fr.reason), systemDupCount);
        const adoptionsDensity = computeMaxDensityPeriod(adopterAdoptions as any, RECORD_TYPES.ADOPTION, adoptionConfig.periodDays);
        if (adoptionsDensity.count >= adoptionConfig.threshold) {
            flags.tooManyAdoptions = {
                count: adoptionsDensity.count, threshold: adoptionConfig.threshold, periodDays: adoptionConfig.periodDays,
                actualSpanDays: adoptionsDensity.timeSpanDays, startDate: adoptionsDensity.startDate, endDate: adoptionsDensity.endDate,
            };
        }
        const requestsDensity = computeMaxDensityPeriod(adopterAdoptions as any, RECORD_TYPES.REQUEST, adoptionConfig.requestsPeriodDays);
        if (requestsDensity.count >= adoptionConfig.requestsThreshold) {
            flags.tooManyRequests = {
                count: requestsDensity.count, threshold: adoptionConfig.requestsThreshold, periodDays: adoptionConfig.requestsPeriodDays,
                actualSpanDays: requestsDensity.timeSpanDays, startDate: requestsDensity.startDate, endDate: requestsDensity.endDate,
            };
        }

        const stats = computeStats(adopterStatRecords, adopterAdoptions);
        stats.adoptions = adoptionCount;
        stats.requests = requestCount;

        resultMap.set(id, { avgRating, thumbnail: thumbByAdopter.get(id) || null, stats, flags });
    }

    return resultMap;
}
