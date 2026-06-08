'use server';

import { adopters, adoptions, adopterImages, adopterFlags, adopterStats, formSubmissions, duplicateCandidates, contractInvitations, adopterHistory } from '@/db/schema';
import { eq, sql, and, inArray, isNull, isNotNull, or } from 'drizzle-orm';
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
        // v2.19.10: count of signed contracts per adopter. Modern token-
        // invitation flow stamps contract_invitations.used_at on a successful
        // sign; the legacy open path that creates a new adopter via
        // _adopterFactory already shows up via `source='contract'` in the
        // Origin column, but doesn't get counted here either (no invitation
        // row). Net effect: this counter reflects "contracts signed against
        // this profile via the modern flow" — same shape as formCount.
        const allContractCounts = await db.select({
            adopterId: contractInvitations.adopterId,
            count: sql<number>`COUNT(*)`
        }).from(contractInvitations)
            .where(and(
                inArray(contractInvitations.adopterId, adopterIds),
                isNotNull(contractInvitations.usedAt),
            ))
            .groupBy(contractInvitations.adopterId)
            .all();
        // v2.19.13: last editor per adopter for the new provenance cell.
        // Fetch all kind='edit' history rows in adopterIds, ordered DESC by
        // changedAt; pick the first one per adopter in JS. kind='contribution'
        // rows (open-add path) are excluded — those don't count as editing
        // the record. Bounded cost: ~30 adopters × handful of edits each.
        const allEditRows = await db.select({
            adopterId: adopterHistory.adopterId,
            changedBy: adopterHistory.changedBy,
            changedAt: adopterHistory.changedAt,
        }).from(adopterHistory)
            .where(and(
                inArray(adopterHistory.adopterId, adopterIds),
                eq(adopterHistory.kind, 'edit'),
            ))
            .orderBy(sql`${adopterHistory.changedAt} DESC`)
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
        const signedContractCountMap = new Map<string, number>();
        for (const row of allContractCounts as { adopterId: string; count: number }[]) {
            if (row.adopterId) signedContractCountMap.set(row.adopterId, row.count);
        }
        // First seen wins per adopter — rows came back ORDER BY changedAt DESC.
        // Date is preserved as the canonical "last edit" timestamp (which the
        // existing updatedAt mirrors today but is a different concept once
        // we add edit-only filtering).
        interface LastEdit { editorEmail: string; editedAt: number }
        const lastEditMap = new Map<string, LastEdit>();
        for (const row of allEditRows as { adopterId: string; changedBy: string | null; changedAt: number | Date | null }[]) {
            if (!row.adopterId || lastEditMap.has(row.adopterId)) continue;
            const editorEmail = (row.changedBy ?? '').trim();
            if (!editorEmail || editorEmail === 'anonymous') continue;
            const editedAt = typeof row.changedAt === 'number'
                ? row.changedAt
                : row.changedAt instanceof Date ? Math.floor(row.changedAt.getTime() / 1000) : 0;
            lastEditMap.set(row.adopterId, { editorEmail, editedAt });
        }

        // v2.19.6: resolve creator name + org for each row. Two batches over
        // the distinct creator emails — display name from `user.name` and
        // shared-org via pickAttributionOrg. Same enrichment pattern
        // getOrgActivity uses; ~30 rows × ~5 distinct creators is realistic.
        //
        // v2.19.12: self-rows are NOT excluded anymore — the viewer's own
        // records get the same name + org treatment as teammate rows. The
        // earlier "Vos / You" label distinguished self from unknown but read
        // as inconsistent next to fully-resolved teammate rows. Showing the
        // viewer's own display name makes the column symmetric and harder
        // to misread.
        const creatorEmailSet = new Set<string>();
        for (const a of adoptersList as typeof adopters.$inferSelect[]) {
            // v2.19.8: skip the 'anonymous' schema-default sentinel
            // (src/db/schema.ts:21 — `text("added_by").default("anonymous")`).
            // It's a "no real creator" marker, not an email; resolving it
            // would surface "👤 anonymous" in the column, which reads as
            // a bug. Treated the same as null/empty so the renderer falls
            // through to the unknown-creator dash + tooltip.
            if (a.addedBy && a.addedBy !== 'anonymous') {
                creatorEmailSet.add(a.addedBy);
            }
        }
        // v2.19.13: also enrich every distinct LAST-EDITOR for the new
        // provenance cell so we don't burn a 2nd pass of lookups.
        for (const { editorEmail } of lastEditMap.values()) {
            creatorEmailSet.add(editorEmail);
        }
        const distinctCreators: string[] = Array.from(creatorEmailSet);
        const creatorNameMap = new Map<string, string>();
        const creatorOrgMap = new Map<string, string | null>();
        if (distinctCreators.length > 0) {
            const { resolveDisplayName } = await import('./notifications');
            const { pickAttributionOrg } = await import('@/lib/orgMembership');
            await Promise.all(distinctCreators.map(async (email) => {
                try {
                    const [name, org] = await Promise.all([
                        resolveDisplayName(email),
                        pickAttributionOrg(email, userEmail!),
                    ]);
                    creatorNameMap.set(email, name);
                    creatorOrgMap.set(email, org?.name ?? null);
                } catch (e) {
                    // Falls back to email-prefix at render time; never block
                    // the dashboard on a creator lookup hiccup.
                    logger.warn('getMyAdopters: creator enrichment failed', {
                        creator: email, viewer: userEmail,
                        error: e instanceof Error ? e.message : String(e),
                    });
                }
            }));
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

            // v2.19.12: enriched creator info for every row, viewer's own
            // included. The Created-by column is symmetric — your name + org
            // for self-rows, teammate's name + org for teammate-rows. Only
            // 'anonymous' sentinel + null/empty fall through to the dash.
            const creatorEmail = adopter.addedBy && adopter.addedBy !== 'anonymous' ? adopter.addedBy : null;
            const creatorName = creatorEmail ? (creatorNameMap.get(creatorEmail) ?? creatorEmail.split('@')[0]) : null;
            const creatorOrgName = creatorEmail ? (creatorOrgMap.get(creatorEmail) ?? null) : null;
            const creatorIsSelf = creatorEmail === userEmail;

            // v2.19.13: last-editor enrichment for the new provenance cell.
            // Suppressed when the most-recent edit is by the creator at
            // creation time (same author + same timestamp): brand-new rows
            // shouldn't render "Editado por X" as a separate line just
            // because saveAdopter wrote a redundant history row.
            const lastEdit = lastEditMap.get(adopter.id);
            const lastEditorName = lastEdit ? (creatorNameMap.get(lastEdit.editorEmail) ?? lastEdit.editorEmail.split('@')[0]) : null;
            const lastEditorOrgName = lastEdit ? (creatorOrgMap.get(lastEdit.editorEmail) ?? null) : null;
            const lastEditorIsSelf = lastEdit ? lastEdit.editorEmail === userEmail : false;

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
                signedContractCount: signedContractCountMap.get(adopter.id) ?? 0,
                hasPendingDuplicate: adoptersWithPendingDup.has(adopter.id),
                creatorName,
                creatorOrgName,
                creatorIsSelf,
                // v2.19.13: last-editor fields. lastEditedBy/lastEditedAt are
                // null when the record has never been edited (saveAdopter not
                // called after creation) or when the only editor is the
                // 'anonymous' sentinel.
                lastEditorName,
                lastEditorOrgName,
                lastEditedAt: lastEdit?.editedAt ?? null,
                lastEditorIsSelf,
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
