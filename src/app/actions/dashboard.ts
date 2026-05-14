'use server';

import { adopters, adoptions, adopterImages, adopterFlags, adopterStats, formSubmissions, duplicateCandidates } from '@/db/schema';
import { eq, sql, and, inArray, isNull, or } from 'drizzle-orm';
import { auth } from '@/auth';
import { logger } from '@/lib/logger';
import { getDb } from './_db';
import { getAdoptionConfig } from './config';
import { getOrgMemberEmails } from './organizations';
import { DASHBOARD_RECENT_ACTIVITY_LIMIT, ADMIN_STATS_EXCLUSION_SQL } from '@/config/constants';
import type { AdopterFlags } from '@/types/adopter';
import { computeAvgRating } from '@/domain/ratings';
import { buildFlags } from '@/domain/flags';
import { RECORD_TYPES } from '@/domain/constants';
import { computeMaxDensityPeriod } from '@/lib/adoptionFilters';

export async function getMyAdopters(sort: 'date' | 'name' = 'date') {
    let userEmail: string | undefined;
    try {
        const db = await getDb();
        if (!db) return [];

        const session = await auth();
        if (!session?.user?.email) return [];
        userEmail = session.user.email;

        // Scope by org membership: show records from all org members
        const memberEmails = await getOrgMemberEmails();

        const query = db.select().from(adopters)
            .where(inArray(adopters.addedBy, memberEmails));

        if (sort === 'name') {
            query.orderBy(adopters.name);
        } else {
            query.orderBy(sql`${adopters.createdAt} DESC`);
        }

        const adoptersList = await query.all();

        const adopterIds = adoptersList.map((a: typeof adopters.$inferSelect) => a.id);
        const uniqueAdopterIds = new Set(adopterIds);
        if (adopterIds.length !== uniqueAdopterIds.size) {
            logger.warn('getMyAdopters returned duplicate adopter ids', {
                total: adoptersList.length,
                unique: uniqueAdopterIds.size,
                duplicated: adopterIds.length - uniqueAdopterIds.size,
            });
        }

        if (adoptersList.length === 0) return [];

        // Batch queries: form submission counts + existing
        // Running sequentially to prevent local D1 miniflare deadlocks
        const adoptionConfig = await getAdoptionConfig();
        const allImages = await db.select({
            adopterId: adopterImages.adopterId,
            url: adopterImages.url,
            isProfilePicture: adopterImages.isProfilePicture,
            uploadedAt: adopterImages.uploadedAt
        }).from(adopterImages)
            .where(and(inArray(adopterImages.adopterId, adopterIds), isNull(adopterImages.adoptionId)))
            .orderBy(sql`${adopterImages.isProfilePicture} DESC, ${adopterImages.uploadedAt} DESC`)
            .all();
        const allFlags = await db.select({
            adopterId: adopterFlags.adopterId,
            reason: adopterFlags.reason
        }).from(adopterFlags)
            .where(inArray(adopterFlags.adopterId, adopterIds))
            .all();
        const allAdoptionCounts = await db.select({
            adopterId: adoptions.adopterId,
            recordType: adoptions.recordType,
            count: sql<number>`COUNT(*)`
        }).from(adoptions)
            .where(inArray(adoptions.adopterId, adopterIds))
            .groupBy(adoptions.adopterId, adoptions.recordType)
            .all();
        const allStats = await db.select({
            adopterId: adopterStats.adopterId,
            eventType: adopterStats.eventType,
            count: sql<number>`COUNT(*)`
        }).from(adopterStats)
            .where(and(
                inArray(adopterStats.adopterId, adopterIds),
                sql`(${adopterStats.userId} IS NULL OR ${adopterStats.userId} NOT IN (${sql.raw(ADMIN_STATS_EXCLUSION_SQL)}))`
            ))
            .groupBy(adopterStats.adopterId, adopterStats.eventType)
            .all();
        const allAdoptionRecords = await db.select({
            adopterId: adoptions.adopterId,
            recordType: adoptions.recordType,
            date: adoptions.date,
            // v37: rating MUST be in the projection — without it computeAvgRating
            // sees r.rating === undefined, passes the `!== null` filter, then
            // sums to NaN → JSON-serializes to null → every /my-adopters row
            // rendered "—" regardless of actual rated activity.
            rating: adoptions.rating,
        }).from(adoptions)
            .where(inArray(adoptions.adopterId, adopterIds))
            .all();
        const allFormCounts = await db.select({
            linkedAdopterId: formSubmissions.linkedAdopterId,
            count: sql<number>`COUNT(*)`
        }).from(formSubmissions)
            .where(inArray(formSubmissions.linkedAdopterId, adopterIds))
            .groupBy(formSubmissions.linkedAdopterId)
            .all();
        // v38: per-row "Posible duplicado" indicator. One query gets every
        // pending dedup pair where either side is in the user's adopter list;
        // the Set is consulted at render time below.
        const dupPairs = await db.select({
            a1: duplicateCandidates.adopter1Id,
            a2: duplicateCandidates.adopter2Id,
        }).from(duplicateCandidates)
            .where(and(
                eq(duplicateCandidates.status, 'pending'),
                or(
                    inArray(duplicateCandidates.adopter1Id, adopterIds),
                    inArray(duplicateCandidates.adopter2Id, adopterIds),
                ),
            ))
            .all() as Array<{ a1: string; a2: string }>;
        const adoptersWithPendingDup = new Set<string>();
        for (const p of dupPairs) {
            adoptersWithPendingDup.add(p.a1);
            adoptersWithPendingDup.add(p.a2);
        }

        // Build lookup maps
        // Ratings: compute from allAdoptionRecords using domain function (replaces separate AVG SQL query)
        const ratingsMap = new Map<string, number | null>();
        const recordsByAdopter = new Map<string, typeof allAdoptionRecords>();
        for (const rec of allAdoptionRecords as any[]) {
            if (!recordsByAdopter.has(rec.adopterId)) recordsByAdopter.set(rec.adopterId, []);
            recordsByAdopter.get(rec.adopterId)!.push(rec);
        }
        for (const [adopterId, records] of recordsByAdopter) {
            ratingsMap.set(adopterId, computeAvgRating(records as any));
        }

        const imagesMap = new Map<string, string>();
        for (const img of allImages as any[]) {
            if (!imagesMap.has(img.adopterId)) {
                imagesMap.set(img.adopterId, img.url);
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
            if (c.recordType === RECORD_TYPES.ADOPTION) entry.adoptions = c.count;
            else if (c.recordType === RECORD_TYPES.REQUEST) entry.requests = c.count;
        }

        const statsMap = new Map<string, { searchHits: number; profileViews: number }>();
        for (const s of allStats as any[]) {
            if (!statsMap.has(s.adopterId)) statsMap.set(s.adopterId, { searchHits: 0, profileViews: 0 });
            const entry = statsMap.get(s.adopterId)!;
            if (s.eventType === 'search_hit') entry.searchHits = s.count;
            else if (s.eventType === 'profile_view') entry.profileViews = s.count;
        }

        const formCountMap = new Map<string, number>();
        for (const row of allFormCounts as { linkedAdopterId: string; count: number }[]) {
            if (row.linkedAdopterId) formCountMap.set(row.linkedAdopterId, row.count);
        }

        // Assemble results in memory (no more DB calls)
        const enrichedAdopters = adoptersList.map((adopter: typeof adopters.$inferSelect) => {
            const flags = flagsMap.get(adopter.id) || [];
            const counts = countsMap.get(adopter.id) || { adoptions: 0, requests: 0 };
            const stats = statsMap.get(adopter.id) || { searchHits: 0, profileViews: 0 };

            const adopterRecords = recordsByAdopter.get(adopter.id) || [];
            const adoptionsDensity = computeMaxDensityPeriod(adopterRecords as any, RECORD_TYPES.ADOPTION, adoptionConfig.periodDays);
            const requestsDensity = computeMaxDensityPeriod(adopterRecords as any, RECORD_TYPES.REQUEST, adoptionConfig.requestsPeriodDays);

            const flagObj: AdopterFlags = buildFlags(flags, 0);
            
            flagObj.tooManyAdoptions = adoptionsDensity.count >= adoptionConfig.threshold
                ? { 
                    count: adoptionsDensity.count, 
                    threshold: adoptionConfig.threshold, 
                    periodDays: adoptionConfig.periodDays,
                    actualSpanDays: adoptionsDensity.timeSpanDays,
                    startDate: adoptionsDensity.startDate,
                    endDate: adoptionsDensity.endDate
                  }
                : null;
                
            flagObj.tooManyRequests = requestsDensity.count >= adoptionConfig.requestsThreshold
                ? { 
                    count: requestsDensity.count, 
                    threshold: adoptionConfig.requestsThreshold, 
                    periodDays: adoptionConfig.requestsPeriodDays,
                    actualSpanDays: requestsDensity.timeSpanDays,
                    startDate: requestsDensity.startDate,
                    endDate: requestsDensity.endDate
                  }
                : null;

            return {
                ...adopter,
                avgRating: ratingsMap.get(adopter.id) ?? null,
                thumbnail: imagesMap.get(adopter.id) ?? null,
                flags: flagObj,
                adoptionCount: counts.adoptions,
                requestCount: counts.requests,
                searchHits: stats.searchHits,
                profileViews: stats.profileViews,
                formCount: formCountMap.get(adopter.id) ?? 0,
                hasPendingDuplicate: adoptersWithPendingDup.has(adopter.id),
            };
        });

        return enrichedAdopters;
    } catch (error) {
        logger.error('getMyAdopters failed', error, { userEmail, sort });
        return [];
    }
}

export async function getMyAdoptions(filter: 'all' | 'adoption' | 'adoption_request' | 'observation' | 'follow_up' | 'returned_pet' = 'all', sort: 'date' | 'name' = 'date') {
    let userEmail: string | undefined;
    try {
        const db = await getDb();
        if (!db) return [];
        const session = await auth();
        if (!session?.user?.email) return [];
        userEmail = session.user.email;

        // Scope by org membership
        const memberEmails = await getOrgMemberEmails();

        const query = db.select().from(adoptions);

        // Apply filters by recordType — always exclude 'available' (those belong on /my-animals)
        if (filter !== 'all') {
            query.where(sql`${adoptions.addedBy} IN (${sql.join(memberEmails.map(e => sql`${e}`), sql`, `)}) AND ${adoptions.recordType} = ${filter}`);
        } else {
            query.where(sql`${adoptions.addedBy} IN (${sql.join(memberEmails.map(e => sql`${e}`), sql`, `)}) AND (${adoptions.recordType} IS NULL OR ${adoptions.recordType} != 'available')`);
        }

        if (sort === 'name') {
            query.orderBy(adoptions.animalName);
        } else {
            query.orderBy(sql`${adoptions.date} DESC`);
        }

        const results = await query.all();

        // Fetch images and adopter name for each adoption
        const adoptionsWithDetails = [];
        for (const adoption of results) {
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

            adoptionsWithDetails.push({ ...adoption, images, adopterName });
        }

        return adoptionsWithDetails;
    } catch (error) {
        logger.error('getMyAdoptions failed', error, { userEmail, filter, sort });
        return [];
    }
}
