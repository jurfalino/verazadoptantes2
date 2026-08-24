'use server';

import { adopters, adoptions, adopterImages, adopterFlags, adopterStats, formSubmissions, duplicateCandidates, contractInvitations, adopterHistory } from '@/db/schema';
import { eq, sql, and, isNull, isNotNull, or } from 'drizzle-orm';
import { auth } from '@/auth';
import { logger } from '@/lib/logger';
import { chunk, D1_IN_CHUNK } from '@/lib/chunk';
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

        // v2.25.2: exclude soft-deleted (merged/removed) adopters — they should
        // not appear on /my-adopters. Also drops them from adopterIds below,
        // which keeps the enrichment param-count honest.
        // memberEmails is always non-empty (getOrgMemberEmails includes self),
        // so the IN list is safe. D1-safe sql.join rather than inArray().
        const memberList = sql.join(memberEmails.map((e) => sql`${e}`), sql`, `);
        const query = db.select().from(adopters)
            .where(and(
                sql`${adopters.addedBy} IN (${memberList})`,
                isNull(adopters.deletedAt),
            ));

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

        const adoptionConfig = await getAdoptionConfig();

        // v2.25.2: enrichment batch queries, chunked to stay under D1's 100
        // bound-parameter cap. These previously ran as single
        // inArray(adopterIds) queries; a user with ≥50 adopters overflowed the
        // dup-candidates query below (status + adopter1_id IN(N) + adopter2_id
        // IN(N) = 1 + 2N params, > 100 at N≥50), getMyAdopters threw, and the
        // whole list came back empty. Same D1-safe IN(?, ?, …) + chunk pattern
        // as enrichAdopters.ts — each id is its own bound param via sql.join,
        // and the doubled dup query is why D1_IN_CHUNK*2 + 1 must stay ≤ 100.
        // This is a correctness stopgap; the real scale fix is paginating the
        // list so only the visible page is enriched.
        //
        // Chunking is safe for the GROUP BY / ORDER BY queries because chunks
        // partition adopterIds and every query filters by adopterId, so an
        // adopter's rows are wholly within one chunk — per-adopter counts and
        // first-seen (thumbnail, last edit) stay correct across the concat.
        type ImageRow = { adopterId: string; url: string; isProfilePicture: number | null; uploadedAt: number | null };
        type FlagRow = { adopterId: string; reason: string };
        type CountRow = { adopterId: string; recordType: string | null; count: number };
        type StatRow = { adopterId: string; eventType: string; count: number };
        type RecordRow = { adopterId: string; recordType: string | null; date: number | null; rating: number | null };
        type FormCountRow = { linkedAdopterId: string; count: number };
        type ContractCountRow = { adopterId: string; count: number };
        type EditRow = { adopterId: string; changedBy: string | null; changedAt: number | Date | null };
        type DupRow = { a1: string; a2: string };

        const allImages: ImageRow[] = [];
        const allFlags: FlagRow[] = [];
        const allAdoptionCounts: CountRow[] = [];
        const allStats: StatRow[] = [];
        const allAdoptionRecords: RecordRow[] = [];
        const allFormCounts: FormCountRow[] = [];
        const allContractCounts: ContractCountRow[] = [];
        const allEditRows: EditRow[] = [];
        const dupPairs: DupRow[] = [];

        for (const idChunk of chunk(adopterIds, D1_IN_CHUNK)) {
            const inList = sql.join(idChunk.map((id) => sql`${id}`), sql`, `);
            const [imgs, flags, counts, stats, records, forms, contracts, edits, dups] = await Promise.all([
                db.select({
                    adopterId: adopterImages.adopterId,
                    url: adopterImages.url,
                    isProfilePicture: adopterImages.isProfilePicture,
                    uploadedAt: adopterImages.uploadedAt,
                }).from(adopterImages)
                    // v2.26.1: profile-level images OR the explicitly-flagged profile
                    // picture wherever it lives (an activity/observation photo can be
                    // the avatar). Ordered isProfilePicture DESC so the flag wins.
                    .where(and(
                        sql`${adopterImages.adopterId} IN (${inList})`,
                        or(isNull(adopterImages.adoptionId), eq(adopterImages.isProfilePicture, 1)),
                    ))
                    .orderBy(sql`${adopterImages.isProfilePicture} DESC, ${adopterImages.uploadedAt} DESC`)
                    .all(),
                db.select({ adopterId: adopterFlags.adopterId, reason: adopterFlags.reason })
                    .from(adopterFlags)
                    .where(sql`${adopterFlags.adopterId} IN (${inList})`)
                    .all(),
                db.select({ adopterId: adoptions.adopterId, recordType: adoptions.recordType, count: sql<number>`COUNT(*)` })
                    .from(adoptions)
                    .where(sql`${adoptions.adopterId} IN (${inList})`)
                    .groupBy(adoptions.adopterId, adoptions.recordType)
                    .all(),
                db.select({ adopterId: adopterStats.adopterId, eventType: adopterStats.eventType, count: sql<number>`COUNT(*)` })
                    .from(adopterStats)
                    .where(and(
                        sql`${adopterStats.adopterId} IN (${inList})`,
                        sql`(${adopterStats.userId} IS NULL OR ${adopterStats.userId} NOT IN (${sql.raw(ADMIN_STATS_EXCLUSION_SQL)}))`,
                    ))
                    .groupBy(adopterStats.adopterId, adopterStats.eventType)
                    .all(),
                // v37: rating MUST be in the projection — without it computeAvgRating
                // sees r.rating === undefined, passes the `!== null` filter, then
                // sums to NaN → JSON-serializes to null → every /my-adopters row
                // rendered "—" regardless of actual rated activity.
                db.select({ adopterId: adoptions.adopterId, recordType: adoptions.recordType, date: adoptions.date, rating: adoptions.rating })
                    .from(adoptions)
                    .where(sql`${adoptions.adopterId} IN (${inList})`)
                    .all(),
                db.select({ linkedAdopterId: formSubmissions.linkedAdopterId, count: sql<number>`COUNT(*)` })
                    .from(formSubmissions)
                    .where(sql`${formSubmissions.linkedAdopterId} IN (${inList})`)
                    .groupBy(formSubmissions.linkedAdopterId)
                    .all(),
                // v2.19.10: signed-contract count per adopter via the modern
                // token-invitation flow (used_at stamped on sign).
                db.select({ adopterId: contractInvitations.adopterId, count: sql<number>`COUNT(*)` })
                    .from(contractInvitations)
                    .where(and(
                        sql`${contractInvitations.adopterId} IN (${inList})`,
                        isNotNull(contractInvitations.usedAt),
                    ))
                    .groupBy(contractInvitations.adopterId)
                    .all(),
                // v2.19.13: last editor per adopter (kind='edit', newest first);
                // first-per-adopter is picked in JS below.
                db.select({ adopterId: adopterHistory.adopterId, changedBy: adopterHistory.changedBy, changedAt: adopterHistory.changedAt })
                    .from(adopterHistory)
                    .where(and(
                        sql`${adopterHistory.adopterId} IN (${inList})`,
                        eq(adopterHistory.kind, 'edit'),
                    ))
                    .orderBy(sql`${adopterHistory.changedAt} DESC`)
                    .all(),
                // v38: pending dedup pairs where either side is in this chunk —
                // drives the per-row "Posible duplicado" indicator. This is the
                // query that binds the id list TWICE (see D1_IN_CHUNK note).
                db.select({ a1: duplicateCandidates.adopter1Id, a2: duplicateCandidates.adopter2Id })
                    .from(duplicateCandidates)
                    .where(and(
                        eq(duplicateCandidates.status, 'pending'),
                        sql`(${duplicateCandidates.adopter1Id} IN (${inList}) OR ${duplicateCandidates.adopter2Id} IN (${inList}))`,
                    ))
                    .all(),
            ]);
            allImages.push(...(imgs as ImageRow[]));
            allFlags.push(...(flags as FlagRow[]));
            allAdoptionCounts.push(...(counts as CountRow[]));
            allStats.push(...(stats as StatRow[]));
            allAdoptionRecords.push(...(records as RecordRow[]));
            allFormCounts.push(...(forms as FormCountRow[]));
            allContractCounts.push(...(contracts as ContractCountRow[]));
            allEditRows.push(...(edits as EditRow[]));
            dupPairs.push(...(dups as DupRow[]));
        }

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
            // v2.19.15: skip system-sentinel changedBy values so the new
            // provenance "Editado por …" line doesn't surface internals.
            // Known sentinels: 'anonymous' (schema-default), 'form-submission'
            // and 'contract-submission' (_adopterFactory at creation time —
            // these are kind='edit' by default so they'd otherwise count as
            // the most-recent edit on imported adopters that have never been
            // touched by a human), 'contract-signed-via-invitation' (the
            // modern contract path). General rule: a real editor email
            // contains '@'; everything else is a system identifier we don't
            // want to render.
            if (!editorEmail || !editorEmail.includes('@')) continue;
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
        // v2.25.2: rethrow (was `return []`). A thrown enrichment query used to
        // be swallowed into an empty list that the API returned as 200 OK — a
        // crash was indistinguishable from "you have no adopters", which on a
        // vetting tool reads as data loss. The sole caller (/api/my-adopters)
        // turns this throw into a 500 + errorId so the UI shows an error toast.
        // The legit "empty" early-returns above (no db / no session / no rows)
        // stay as [] — only a real failure surfaces here.
        logger.error('getMyAdopters failed', error, { userEmail, sort });
        throw error;
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

        // Enrich images + adopter names via CHUNKED IN() batches instead of 2
        // queries per row. A large rescuer's list would otherwise fire hundreds
        // of D1 subrequests in one request (past Cloudflare's Workers subrequest
        // limit -> 500), the same class of bug fixed in /api/my-animals. Mirrors
        // getMyAdopters' batched enrichment above.
        const adoptionIds = results.map((r: typeof results[number]) => r.id);
        const adopterIds = Array.from(new Set(
            results.map((r: typeof results[number]) => r.adopterId).filter((x: string | null): x is string => !!x)
        ));

        const imagesByAdoption = new Map<string, { id: string; url: string; caption: string | null }[]>();
        for (const idChunk of chunk(adoptionIds, D1_IN_CHUNK)) {
            const inList = sql.join(idChunk.map((id) => sql`${id}`), sql`, `);
            const imgs = await db.select({
                adoptionId: adopterImages.adoptionId,
                id: adopterImages.id,
                url: adopterImages.url,
                caption: adopterImages.caption,
            })
                .from(adopterImages)
                .where(sql`${adopterImages.adoptionId} IN (${inList})`)
                .all()
                .catch((e: unknown) => {
                    logger.warn('getMyAdoptions: images chunk fallback', { userEmail, error: e instanceof Error ? e.message : String(e) });
                    return [] as { adoptionId: string | null; id: string; url: string; caption: string | null }[];
                });
            for (const img of imgs) {
                if (!img.adoptionId) continue;
                const arr = imagesByAdoption.get(img.adoptionId) ?? [];
                if (arr.length < DASHBOARD_RECENT_ACTIVITY_LIMIT) {
                    arr.push({ id: img.id, url: img.url, caption: img.caption });
                    imagesByAdoption.set(img.adoptionId, arr);
                }
            }
        }

        const nameByAdopter = new Map<string, string>();
        for (const idChunk of chunk(adopterIds, D1_IN_CHUNK)) {
            const inList = sql.join(idChunk.map((id) => sql`${id}`), sql`, `);
            const names = await db.select({ id: adopters.id, name: adopters.name })
                .from(adopters)
                .where(sql`${adopters.id} IN (${inList})`)
                .all()
                .catch((e: unknown) => {
                    logger.warn('getMyAdoptions: names chunk fallback', { userEmail, error: e instanceof Error ? e.message : String(e) });
                    return [] as { id: string; name: string | null }[];
                });
            for (const n of names) { if (n.name) nameByAdopter.set(n.id, n.name); }
        }

        const adoptionsWithDetails = results.map((adoption: typeof results[number]) => ({
            ...adoption,
            images: imagesByAdoption.get(adoption.id) ?? [],
            adopterName: adoption.adopterId ? (nameByAdopter.get(adoption.adopterId) ?? null) : null,
        }));

        return adoptionsWithDetails;
    } catch (error) {
        logger.error('getMyAdoptions failed', error, { userEmail, filter, sort });
        return [];
    }
}
