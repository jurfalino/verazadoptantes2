'use server';

import { adopters, adoptions, adopterImages, adopterFlags, adopterStats } from '@/db/schema';
import { eq, sql, and, inArray, isNull } from 'drizzle-orm';
import { auth } from '@/auth';
import { logger } from '@/lib/logger';
import { getDb } from './_db';
import { getAdoptionConfig } from './config';
import { DASHBOARD_RECENT_ACTIVITY_LIMIT } from '@/config/constants';
import type { AdopterFlags } from './types';

export async function getMyAdopters(sort: 'date' | 'name' = 'date') {
    try {
        const db = await getDb();
        if (!db) return [];

        const session = await auth();
        if (!session?.user?.email) return [];

        const query = db.select().from(adopters)
            .where(eq(adopters.addedBy, session.user.email));

        if (sort === 'name') {
            query.orderBy(adopters.name);
        } else {
            query.orderBy(sql`${adopters.createdAt} DESC`);
        }

        const adoptersList = await query.all();

        if (adoptersList.length === 0) return [];

        const adopterIds = adoptersList.map((a: typeof adopters.$inferSelect) => a.id);

        // Batch queries: 7 queries total instead of 8 × N
        const [adoptionConfig, allRatings, allImages, allFlags, allAdoptionCounts, allStats, allAdoptionRecords] = await Promise.all([
            getAdoptionConfig(),
            // Average ratings per adopter
            db.select({
                adopterId: adoptions.adopterId,
                avgRating: sql<number>`AVG(${adoptions.rating})`
            }).from(adoptions)
                .where(and(inArray(adoptions.adopterId, adopterIds), eq(adoptions.recordType, 'adoption')))
                .groupBy(adoptions.adopterId)
                .all(),
            // Profile images (all profile images for these adopters)
            db.select({
                adopterId: adopterImages.adopterId,
                url: adopterImages.url,
                isProfilePicture: adopterImages.isProfilePicture,
                uploadedAt: adopterImages.uploadedAt
            }).from(adopterImages)
                .where(and(inArray(adopterImages.adopterId, adopterIds), isNull(adopterImages.adoptionId)))
                .orderBy(sql`${adopterImages.isProfilePicture} DESC, ${adopterImages.uploadedAt} DESC`)
                .all(),
            // All flags
            db.select({
                adopterId: adopterFlags.adopterId,
                reason: adopterFlags.reason
            }).from(adopterFlags)
                .where(inArray(adopterFlags.adopterId, adopterIds))
                .all(),
            // Adoption + request counts per adopter per recordType
            db.select({
                adopterId: adoptions.adopterId,
                recordType: adoptions.recordType,
                count: sql<number>`COUNT(*)`
            }).from(adoptions)
                .where(inArray(adoptions.adopterId, adopterIds))
                .groupBy(adoptions.adopterId, adoptions.recordType)
                .all(),
            // Stats per adopter per eventType
            db.select({
                adopterId: adopterStats.adopterId,
                eventType: adopterStats.eventType,
                count: sql<number>`COUNT(*)`
            }).from(adopterStats)
                .where(inArray(adopterStats.adopterId, adopterIds))
                .groupBy(adopterStats.adopterId, adopterStats.eventType)
                .all(),
            // All adoption records for period calculations
            db.select({
                adopterId: adoptions.adopterId,
                recordType: adoptions.recordType,
                date: adoptions.date
            }).from(adoptions)
                .where(inArray(adoptions.adopterId, adopterIds))
                .all()
        ]);

        // Build lookup maps
        const ratingsMap = new Map(allRatings.map((r: any) => [r.adopterId, r.avgRating]));

        const imagesMap = new Map<string, string>();
        for (const img of allImages as any[]) {
            if (!imagesMap.has(img.adopterId)) {
                imagesMap.set(img.adopterId, img.url); // First match wins (profile pic first due to ORDER BY)
            }
        }

        const flagsMap = new Map<string, string[]>();
        for (const f of allFlags as any[]) {
            if (!flagsMap.has(f.adopterId)) flagsMap.set(f.adopterId, []);
            flagsMap.get(f.adopterId)!.push(f.reason);
        }

        const countsMap = new Map<string, { adoptions: number; requests: number }>();
        for (const c of allAdoptionCounts as any[]) {
            if (!countsMap.has(c.adopterId)) countsMap.set(c.adopterId, { adoptions: 0, requests: 0 });
            const entry = countsMap.get(c.adopterId)!;
            if (c.recordType === 'adoption') entry.adoptions = c.count;
            else if (c.recordType === 'adoption_request') entry.requests = c.count;
        }

        const statsMap = new Map<string, { searchHits: number; profileViews: number }>();
        for (const s of allStats as any[]) {
            if (!statsMap.has(s.adopterId)) statsMap.set(s.adopterId, { searchHits: 0, profileViews: 0 });
            const entry = statsMap.get(s.adopterId)!;
            if (s.eventType === 'search_hit') entry.searchHits = s.count;
            else if (s.eventType === 'profile_view') entry.profileViews = s.count;
        }

        // Period calculations
        const adoptionsCutoff = new Date();
        adoptionsCutoff.setDate(adoptionsCutoff.getDate() - adoptionConfig.periodDays);
        const requestsCutoff = new Date();
        requestsCutoff.setDate(requestsCutoff.getDate() - adoptionConfig.requestsPeriodDays);

        const periodMap = new Map<string, { adoptionsInPeriod: number; requestsInPeriod: number }>();
        for (const a of allAdoptionRecords as any[]) {
            if (!periodMap.has(a.adopterId)) periodMap.set(a.adopterId, { adoptionsInPeriod: 0, requestsInPeriod: 0 });
            const entry = periodMap.get(a.adopterId)!;
            const aDate = a.date ? (typeof a.date === 'number' ? new Date(a.date * 1000) : new Date(a.date)) : null;
            if (!aDate) continue;
            if (a.recordType === 'adoption' && aDate >= adoptionsCutoff) entry.adoptionsInPeriod++;
            if (a.recordType === 'adoption_request' && aDate >= requestsCutoff) entry.requestsInPeriod++;
        }

        // Assemble results in memory (no more DB calls)
        const enrichedAdopters = adoptersList.map((adopter: typeof adopters.$inferSelect) => {
            const flags = flagsMap.get(adopter.id) || [];
            const counts = countsMap.get(adopter.id) || { adoptions: 0, requests: 0 };
            const stats = statsMap.get(adopter.id) || { searchHits: 0, profileViews: 0 };
            const period = periodMap.get(adopter.id) || { adoptionsInPeriod: 0, requestsInPeriod: 0 };

            const flagsObj: AdopterFlags = {
                inaccurate: flags.includes('inaccurate_information'),
                duplicate: flags.includes('duplicate'),
                systemDuplicate: false,
                verified_identity: flags.includes('verified_identity'),
                verified_address: flags.includes('verified_address'),
                tooManyAdoptions: period.adoptionsInPeriod >= adoptionConfig.threshold
                    ? { count: period.adoptionsInPeriod, threshold: adoptionConfig.threshold, periodDays: adoptionConfig.periodDays }
                    : null,
                tooManyRequests: period.requestsInPeriod >= adoptionConfig.requestsThreshold
                    ? { count: period.requestsInPeriod, threshold: adoptionConfig.requestsThreshold, periodDays: adoptionConfig.requestsPeriodDays }
                    : null
            };

            return {
                ...adopter,
                avgRating: ratingsMap.get(adopter.id) ?? null,
                thumbnail: imagesMap.get(adopter.id) ?? null,
                flags: flagsObj,
                adoptionCount: counts.adoptions,
                requestCount: counts.requests,
                searchHits: stats.searchHits,
                profileViews: stats.profileViews
            };
        });

        return enrichedAdopters;
    } catch (error) {
        logger.error('getMyAdopters failed', error);
        return [];
    }
}

export async function getMyAdoptions(filter: 'all' | 'adoption' | 'adoption_request' | 'observation' | 'follow_up' | 'returned_pet' = 'all', sort: 'date' | 'name' = 'date') {
    try {
        const db = await getDb();
        if (!db) return [];
        const session = await auth();
        if (!session?.user?.email) return [];

        const query = db.select().from(adoptions);

        // Apply filters by recordType
        if (filter !== 'all') {
            query.where(sql`${adoptions.addedBy} = ${session.user.email} AND ${adoptions.recordType} = ${filter}`);
        } else {
            query.where(eq(adoptions.addedBy, session.user.email));
        }

        if (sort === 'name') {
            query.orderBy(adoptions.animalName);
        } else {
            query.orderBy(sql`${adoptions.date} DESC`);
        }

        const results = await query.all();

        // Fetch images and adopter name for each adoption
        const adoptionsWithDetails = await Promise.all(
            results.map(async (adoption: typeof adoptions.$inferSelect) => {
                // Fetch images
                const images = await db.select({
                    id: adopterImages.id,
                    url: adopterImages.url,
                    caption: adopterImages.caption
                })
                    .from(adopterImages)
                    .where(eq(adopterImages.adoptionId, adoption.id))
                    .limit(DASHBOARD_RECENT_ACTIVITY_LIMIT)
                    .all();

                // Fetch adopter name if linked
                let adopterName: string | null = null;
                if (adoption.adopterId) {
                    const adopter = await db.select({ name: adopters.name })
                        .from(adopters)
                        .where(eq(adopters.id, adoption.adopterId))
                        .get();
                    adopterName = adopter?.name || null;
                }

                return { ...adoption, images, adopterName };
            })
        );

        return adoptionsWithDetails;
    } catch (error) {
        logger.error('getMyAdoptions failed', error);
        return [];
    }
}
