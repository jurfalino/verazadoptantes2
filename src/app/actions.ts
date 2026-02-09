'use server';

import { getRequestContext } from '@cloudflare/next-on-pages';
import { createDb } from '@/db';
import { revalidatePath } from 'next/cache';
import { adopters, searches, adopterHistory, adoptions, adopterImages, adopterFlags, adopterStats, adoptionImages, appConfig } from '@/db/schema';
import { or, like, eq, sql, and, gte, isNull, inArray } from 'drizzle-orm';
import { auth } from '@/auth';
import { logger, withTrace } from '@/lib/logger';
import { logAudit } from '@/lib/audit';

export interface AdopterFlags {
    inaccurate: boolean;
    duplicate: boolean;
    verified_identity: boolean;
    verified_address: boolean;
    tooManyAdoptions: { count: number; threshold: number; periodDays: number } | null;
    tooManyRequests: { count: number; threshold: number; periodDays: number } | null;
}

export interface SearchResult {
    adopter: typeof adopters.$inferSelect;
    matchContext?: string;
    avgRating: number | null;
    thumbnail: string | null;
    stats: {
        searchHits: number;
        profileViews: number;
        requests: number;
        adoptions: number;
    };
    flags: AdopterFlags;
}

export interface SearchResponse {
    results: SearchResult[];
    truncated?: boolean;
    totalCount?: number;
    validationError?: 'min_digits';
}

// Constants for search limits
const SEARCH_RESULT_LIMIT = 50;
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

export async function getDb() {
    try {
        const { env } = getRequestContext();
        if (env && env.DB) {
            return await createDb(env.DB);
        }
    } catch (e) {
        // Ignore - not in Cloudflare context
    }

    // Fallback for local development
    if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
        try {
            const { createLocalDb } = await import('@/db/local');
            return await createLocalDb('local.db');
        } catch (e) {
            console.error("[getDb] Local DB Init Error:", e);
        }
    }
    return undefined;
}

export async function getUser() {
    try {
        const session = await auth();
        if (session?.user?.email) return session.user.email;
    } catch (e) {
        console.error("getUser Auth Error:", e);
        // Auth failed
    }

    return 'anonymous';
}

import { isAdmin as checkIsAdmin } from '@/config/admins';

export async function getIsAdmin(): Promise<boolean> {
    try {
        const session = await auth();
        return checkIsAdmin(session?.user?.email);
    } catch (e) {
        return false;
    }
}



// Helper to perform parallel searches
async function searchHistoryIds(db: any, query: string): Promise<string[]> {
    try {
        // Search in history for JSON changes containing the query
        // Note: 'like' on text column is expensive but necessary for this requirement
        const logs = await db.select({ adopterId: adopterHistory.adopterId })
            .from(adopterHistory)
            .where(like(adopterHistory.changes, `%${query}%`))
            .limit(50);
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
            .limit(50);
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
            } catch (e) { }
        })();

        // 1. Search Main Profile (Name, Contact, Address, Family)
        const profileQuery = db.select().from(adopters).where(
            or(
                like(adopters.name, `%${normalizedQuery}%`),
                like(adopters.contactInfo, `%${normalizedQuery}%`),
                like(adopters.familyMembers, `%${normalizedQuery}%`)
            )
        ).limit(20);

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
        const adoptionMap = new Map<string, { avgRating: number | null; count: number }>();
        const flagsMap = new Map<string, AdopterFlags>();
        const statsMap = new Map<string, { searchHits: number; profileViews: number; requests: number; adoptions: number }>();
        const thumbnailMap = new Map<string, string>();
        const allAdoptionRecords: { adopterId: string; recordType: string | null; date: number | null }[] = [];

        // Fetch data for each adopter in parallel (D1 compatible - uses eq() not inArray())
        await Promise.all(allProfiles.map(async (adopter) => {
            const adopterId = adopter.id;

            // Run all 4 enrichment queries in parallel for this adopter
            const [adopterAdoptions, adopterFlagRecords, adopterStatRecords, adopterImagesResult] = await Promise.all([
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
                    .limit(1).catch(() => [])
            ]);

            // Process adoptions
            if (adopterAdoptions.length > 0) {
                const avgRating = adopterAdoptions.reduce((sum: number, a: { rating: number | null }) => sum + (a.rating || 0), 0) / adopterAdoptions.length;
                adoptionMap.set(adopterId, { avgRating, count: adopterAdoptions.length });
                for (const rec of adopterAdoptions) {
                    allAdoptionRecords.push({ adopterId, recordType: rec.recordType, date: rec.date });
                }
            }

            // Process flags
            const flags: AdopterFlags = {
                inaccurate: false,
                duplicate: false,
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

            // Process stats
            const stats = { searchHits: 0, profileViews: 0, requests: 0, adoptions: 0 };
            for (const s of adopterStatRecords) {
                if (s.eventType === 'search_hit') stats.searchHits++;
                else if (s.eventType === 'profile_view') stats.profileViews++;
                else if (s.eventType === 'adoption_request') stats.requests++;
                else if (s.eventType === 'adoption_completed') stats.adoptions++;
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
                inaccurate: false, duplicate: false, verified_identity: false, verified_address: false,
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
        for (const [adopterId, flags] of flagsMap) {
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
                verified_identity: false,
                verified_address: false,
                tooManyAdoptions: null,
                tooManyRequests: null
            };
            const flagData = flagsMap.get(a.id) || defaultFlags;
            const statData = statsMap.get(a.id) || { searchHits: 0, profileViews: 0, requests: 0, adoptions: 0 };
            const thumbnail = thumbnailMap.get(a.id) || null;

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

// Fetch adopter stats for different time periods
export async function getAdopterStats(adopterId: string) {
    try {
        const db = await getDb();
        if (!db) return null;

        const now = Date.now() / 1000; // Unix timestamp in seconds
        const ninetyDaysAgo = now - (90 * 24 * 60 * 60);
        const oneYearAgo = now - (365 * 24 * 60 * 60);

        // Fetch all stats for this adopter
        const allStats = await db.select({
            eventType: adopterStats.eventType,
            createdAt: adopterStats.createdAt
        }).from(adopterStats).where(eq(adopterStats.adopterId, adopterId));

        // Aggregate by time period
        const stats = {
            searchHits: { '90d': 0, '1y': 0, 'all': 0 },
            profileViews: { '90d': 0, '1y': 0, 'all': 0 },
            adoptionRequests: { '90d': 0, '1y': 0, 'all': 0 },
            adoptionsCompleted: { '90d': 0, '1y': 0, 'all': 0 }
        };

        for (const s of allStats) {
            const ts = s.createdAt ? new Date(s.createdAt).getTime() / 1000 : 0;
            const bucket = s.eventType === 'search_hit' ? 'searchHits' :
                s.eventType === 'profile_view' ? 'profileViews' :
                    s.eventType === 'adoption_request' ? 'adoptionRequests' :
                        s.eventType === 'adoption_completed' ? 'adoptionsCompleted' : null;

            if (bucket) {
                stats[bucket].all++;
                if (ts >= oneYearAgo) stats[bucket]['1y']++;
                if (ts >= ninetyDaysAgo) stats[bucket]['90d']++;
            }
        }

        return stats;
    } catch (error) {
        console.error("Get adopter stats error:", error);
        logger.error('Get adopter stats failed', error, { adopterId });
        return null;
    }
}

// Log a profile view event
export async function logProfileView(adopterId: string) {
    try {
        const db = await getDb();
        if (!db) return;

        await db.insert(adopterStats).values({
            id: crypto.randomUUID(),
            adopterId,
            eventType: 'profile_view',
            createdAt: new Date()
        });
    } catch (error) {
        console.error("Log profile view error:", error);
        logger.warn('Log profile view failed', { adopterId, error: error instanceof Error ? error.message : String(error) });
    }
}

// Calculate average rating from adoptions
export async function getAverageRating(adopterId: string): Promise<number | null> {
    try {
        const db = await getDb();
        if (!db) return null;

        const result = await db.select({
            avgRating: sql<number>`AVG(${adoptions.rating})`
        }).from(adoptions).where(eq(adoptions.adopterId, adopterId)).get();

        return result?.avgRating ?? null;
    } catch (error) {
        console.error("Get average rating error:", error);
        logger.error('Get average rating failed', error, { adopterId });
        return null;
    }
}

export async function getAdopter(id: string) {
    try {
        const db = await getDb();
        if (!db) return null;

        // Log profile view (fire and forget)
        logProfileView(id).catch(() => { });

        return await db.select().from(adopters).where(eq(adopters.id, id)).get();
    } catch (error) {
        console.error("Get adopter error:", error);
        logger.error('Get adopter failed', error, { adopterId: id });
        return null;
    }
}

export async function saveAdopter(data: typeof adopters.$inferInsert) {
    try {
        const db = await getDb();
        if (!db) {
            throw new Error("No database");
        }

        let changedBy = 'Unknown';
        try {
            changedBy = await getUser();
        } catch (e) {
            console.error("getUser failed", e);
        }

        // Check if exists
        const existing = await db.select().from(adopters).where(eq(adopters.id, data.id || 'new')).get();

        if (existing) {
            // Calculate changes
            const changes: Record<string, any> = {};
            let hasChanges = false;

            const fields = ['name', 'contactInfo', 'status', 'familyMembers', 'notes'] as const;
            for (const field of fields) {
                // @ts-ignore
                if (data[field] !== undefined && data[field] !== existing[field]) {
                    // @ts-ignore
                    changes[field] = { from: existing[field], to: data[field] };
                    hasChanges = true;
                }
            }

            if (hasChanges) {
                // Update
                await db.update(adopters).set({
                    ...data,
                    updatedAt: new Date()
                }).where(eq(adopters.id, data.id as string));

                // Log history
                await db.insert(adopterHistory).values({
                    id: crypto.randomUUID(),
                    adopterId: data.id as string,
                    changedBy,
                    changes: JSON.stringify(changes),
                    changedAt: new Date()
                });

                logger.info('Adopter updated', { adopterId: data.id, changedBy });
                logAudit({ userEmail: changedBy, action: 'adopter_updated', target: data.id as string, details: changes });
            }
            return { success: true, id: data.id };
        } else {
            // Create
            const newId = data.id || crypto.randomUUID();
            await db.insert(adopters).values({
                ...data,
                id: newId,
                addedBy: changedBy, // Added this line
                createdAt: new Date(),
                updatedAt: new Date()
            });

            logger.info('Adopter created', { adopterId: newId, changedBy });
            logAudit({ userEmail: changedBy, action: 'adopter_created', target: newId, details: { name: data.name } });
            return { success: true, id: newId };
        }

    } catch (error) {
        console.error("Save adopter error:", error);
        const errorId = logger.error('Save adopter failed', error, { adopterId: data.id });
        throw new Error(`Failed to save adopter (Error ID: ${errorId})`);
    }
}

export async function saveImage(adopterId: string, url: string, caption?: string, adoptionId?: string) {
    try {
        const db = await getDb();
        if (!db) throw new Error("No database");
        const addedBy = await getUser();

        const id = crypto.randomUUID();
        await db.insert(adopterImages).values({
            id,
            adopterId,
            adoptionId: adoptionId || null,
            url,
            caption: caption || null,
            uploadedAt: new Date(),
            addedBy
        });

        return { success: true, id };
    } catch (error) {
        console.error("Save image error:", error);
        const errorId = logger.error('Save image failed', error, { adopterId });
        throw new Error(`Failed to save image (Error ID: ${errorId})`);
    }
}

export async function getImages(adopterId: string) {
    try {
        const db = await getDb();
        if (!db) return [];
        // Only return profile images (where adoptionId is null)
        // Adoption-linked images are fetched via getAdoptionImages
        return await db.select().from(adopterImages)
            .where(and(
                eq(adopterImages.adopterId, adopterId),
                isNull(adopterImages.adoptionId)
            ))
            .orderBy(sql`${adopterImages.uploadedAt} DESC`)
            .all();
    } catch (error) {
        console.error("Get images error:", error);
        logger.error('Get images failed', error, { adopterId });
        return [];
    }
}

export async function setProfilePicture(adopterId: string, imageId: string) {
    try {
        const db = await getDb();
        if (!db) throw new Error("No database");

        // First, unset any existing profile picture for this adopter
        await db.update(adopterImages)
            .set({ isProfilePicture: 0 })
            .where(and(
                eq(adopterImages.adopterId, adopterId),
                eq(adopterImages.isProfilePicture, 1)
            ));

        // Then set the new profile picture
        await db.update(adopterImages)
            .set({ isProfilePicture: 1 })
            .where(eq(adopterImages.id, imageId));

        revalidatePath(`/adopter/${adopterId}`);
        return { success: true };
    } catch (error) {
        console.error("Set profile picture error:", error);
        const errorId = logger.error('Set profile picture failed', error, { adopterId, imageId });
        throw new Error(`Failed to set profile picture (Error ID: ${errorId})`);
    }
}

export async function getAdoptionImages(adoptionId: string) {
    try {
        const db = await getDb();
        if (!db) return [];
        return await db.select().from(adopterImages)
            .where(eq(adopterImages.adoptionId, adoptionId))
            .orderBy(sql`${adopterImages.uploadedAt} DESC`)
            .all();
    } catch (error) {
        console.error("Get adoption images error:", error);
        logger.error('Get adoption images failed', error, { adoptionId });
        return [];
    }
}

export async function getHistory(adopterId: string) {
    try {
        const db = await getDb();
        if (!db) return [];
        // desc order
        return await db.select().from(adopterHistory)
            .where(eq(adopterHistory.adopterId, adopterId))
            .orderBy(sql`${adopterHistory.changedAt} DESC`)
            .all();
    } catch (error) {
        console.error("Get history error:", error);
        logger.error('Get history failed', error, { adopterId });
        return [];
    }
}

export async function getAdoptions(adopterId: string) {
    try {
        const db = await getDb();
        if (!db) return [];
        return await db.select().from(adoptions)
            .where(eq(adoptions.adopterId, adopterId))
            .orderBy(sql`${adoptions.date} DESC`)
            .all();
    } catch (error) {
        console.error("Get adoptions error:", error);
        logger.error('Get adoptions failed', error, { adopterId });
        return [];
    }
}

export async function saveAdoption(data: typeof adoptions.$inferInsert) {
    try {
        const db = await getDb();
        if (!db) throw new Error("No database");
        const changedBy = await getUser();

        // Check if exists (for updates)
        const existing = data.id ? await db.select().from(adoptions).where(eq(adoptions.id, data.id)).get() : null;

        if (existing) {
            // Update existing
            // Calculate changes
            const changes: Record<string, any> = {};
            let hasChanges = false;

            const fields = ['animalName', 'species', 'status', 'rating', 'details', 'adopterId', 'date', 'onBehalfOf', 'recordType', 'deliveredToHome', 'verifiedAddress', 'identityVerified'] as const;
            for (const field of fields) {
                // @ts-ignore
                if (data[field] !== undefined && data[field] !== existing[field]) {
                    // @ts-ignore
                    changes[field] = { from: existing[field], to: data[field] };
                    hasChanges = true;
                }
            }

            if (hasChanges) {
                await db.update(adoptions).set(data).where(eq(adoptions.id, data.id as string));

                // Log to adopter history IF it is linked to an adopter
                const targetAdopterId = data.adopterId || existing.adopterId;
                if (targetAdopterId) {
                    await db.insert(adopterHistory).values({
                        id: crypto.randomUUID(),
                        adopterId: targetAdopterId,
                        changedBy,
                        changes: JSON.stringify({ adoption_updated: changes }),
                        changedAt: new Date()
                    });
                    revalidatePath(`/adopter/${targetAdopterId}`);
                }
            }
            logger.info('Adoption updated', { adoptionId: data.id, adopterId: data.adopterId, changedBy });
            logAudit({ userEmail: changedBy, action: 'adoption_updated', target: data.id as string, details: { adopterId: data.adopterId } });
            return { success: true, id: data.id };
        } else {
            // Create new
            const id = crypto.randomUUID();
            await db.insert(adoptions).values({
                ...data,
                id,
                date: data.date || new Date(),
                addedBy: changedBy
            });

            // Log to adopter history ONLY if linked immediately
            if (data.adopterId) {
                await db.insert(adopterHistory).values({
                    id: crypto.randomUUID(),
                    adopterId: data.adopterId,
                    changedBy,
                    changes: JSON.stringify({
                        adoption_added: {
                            animalName: data.animalName,
                            species: data.species,
                            status: data.status,
                            rating: data.rating
                        }
                    }),
                    changedAt: new Date()
                });

                // If delivered to home with verified address, set address verified flag
                if (data.deliveredToHome && data.verifiedAddress) {
                    // Update adopter's address if different
                    const adopter = await db.select().from(adopters).where(eq(adopters.id, data.adopterId)).get();
                    if (adopter && adopter.contactInfo !== data.verifiedAddress) {
                        const addressPrefix = 'Dirección / Address';
                        await db.update(adopters).set({ contactInfo: adopter.contactInfo ? `${adopter.contactInfo}\n${addressPrefix}: ${data.verifiedAddress}` : `${addressPrefix}: ${data.verifiedAddress}` }).where(eq(adopters.id, data.adopterId));

                        // Log address change in audit history
                        await db.insert(adopterHistory).values({
                            id: crypto.randomUUID(),
                            adopterId: data.adopterId,
                            changedBy,
                            changes: JSON.stringify({
                                contactInfo: {
                                    from: adopter.contactInfo || '(empty)',
                                    to: adopter.contactInfo ? `${adopter.contactInfo}\n${addressPrefix}: ${data.verifiedAddress}` : `${addressPrefix}: ${data.verifiedAddress}`,
                                    reason: 'verified_during_pet_delivery'
                                }
                            }),
                            changedAt: new Date()
                        });
                    }

                    // Check if verified_address flag already exists
                    const existingFlag = await db.select().from(adopterFlags).where(
                        and(
                            eq(adopterFlags.adopterId, data.adopterId),
                            eq(adopterFlags.reason, 'verified_address')
                        )
                    ).get();

                    if (!existingFlag) {
                        await db.insert(adopterFlags).values({
                            id: crypto.randomUUID(),
                            adopterId: data.adopterId,
                            addedBy: changedBy,
                            reason: 'verified_address',
                            details: `Address verified during pet delivery: ${data.verifiedAddress}`,
                            createdAt: new Date()
                        });
                    }
                }

                revalidatePath(`/adopter/${data.adopterId}`);
            }

            logger.info('Adoption created', { adoptionId: id, adopterId: data.adopterId, species: data.species, changedBy });
            logAudit({ userEmail: changedBy, action: 'adoption_created', target: id, details: { adopterId: data.adopterId, species: data.species, animalName: data.animalName } });
            return { success: true, id };
        }
    } catch (error) {
        console.error("Save adoption error:", error);
        const errorId = logger.error('Save adoption failed', error, { adoptionId: data.id, adopterId: data.adopterId });
        throw new Error(`Failed to save adoption (Error ID: ${errorId})`);
    }
}

export async function deleteAdoption(adoptionId: string, adopterId: string) {
    try {
        const db = await getDb();
        if (!db) throw new Error("No database");
        const changedBy = await getUser();

        // Get snapshot before delete
        const existing = await db.select().from(adoptions).where(eq(adoptions.id, adoptionId)).get();
        if (!existing) throw new Error("Adoption not found");

        await db.delete(adoptions).where(eq(adoptions.id, adoptionId));

        // Log to adopter history
        await db.insert(adopterHistory).values({
            id: crypto.randomUUID(),
            adopterId,
            changedBy,
            changes: JSON.stringify({
                adoption_deleted: existing
            }),
            changedAt: new Date()
        });

        logAudit({ action: 'adoption_deleted', target: adoptionId, details: { adopterId } });
        revalidatePath(`/adopter/${adopterId}`);
        return { success: true };
    } catch (error) {
        console.error("Delete adoption error:", error);
        const errorId = logger.error('Delete adoption failed', error, { adoptionId, adopterId });
        throw new Error(`Failed to delete adoption (Error ID: ${errorId})`);
    }
}

export async function deleteImage(imageId: string, adopterId: string) {
    try {
        const db = await getDb();
        if (!db) throw new Error("No database");
        const changedBy = await getUser();

        // Get snapshot
        const existing = await db.select().from(adopterImages).where(eq(adopterImages.id, imageId)).get();
        if (!existing) throw new Error("Image not found");

        await db.delete(adopterImages).where(eq(adopterImages.id, imageId));

        // Log to history
        await db.insert(adopterHistory).values({
            id: crypto.randomUUID(),
            adopterId,
            changedBy,
            changes: JSON.stringify({
                image_deleted: {
                    caption: existing.caption,
                    // Don't log the full base64/url to save space, just metadata
                    uploadedAt: existing.uploadedAt
                }
            }),
            changedAt: new Date()
        });

        revalidatePath(`/adopter/${adopterId}`);
        return { success: true };
    } catch (error) {
        console.error("Delete image error:", error);
        const errorId = logger.error('Delete image failed', error, { imageId, adopterId });
        throw new Error(`Failed to delete image (Error ID: ${errorId})`);
    }
}

export async function flagAdopter(adopterId: string, reason: string, details?: string, targetAdopterId?: string) {
    try {
        const db = await getDb();
        if (!db) throw new Error("No database");
        const flaggedBy = await getUser();

        const id = crypto.randomUUID();
        await db.insert(adopterFlags).values({
            id,
            adopterId,
            flaggedBy,
            reason,
            targetAdopterId,
            details,
            createdAt: new Date()
        });

        // Log to audit history
        await db.insert(adopterHistory).values({
            id: crypto.randomUUID(),
            adopterId,
            changedBy: flaggedBy,
            changeType: 'flag_added',
            fieldName: reason,
            newValue: details || null,
            changedAt: new Date()
        });

        logAudit({ userEmail: flaggedBy, action: 'flag_created', target: adopterId, details: { reason, details } });
        return { success: true, id };
    } catch (error) {
        console.error("Flag adopter error:", error);
        const errorId = logger.error('Flag adopter failed', error, { adopterId, reason });
        throw new Error(`Failed to flag adopter (Error ID: ${errorId})`);
    }
}

export async function getFlags(adopterId: string) {
    try {
        const db = await getDb();
        if (!db) return [];
        return await db.select().from(adopterFlags)
            .where(eq(adopterFlags.adopterId, adopterId))
            .orderBy(sql`${adopterFlags.createdAt} DESC`)
            .all();
    } catch (error) {
        console.error("Get flags error:", error);
        logger.error('Get flags failed', error, { adopterId });
        return [];
    }
}

export async function dismissFlag(flagId: string) {
    try {
        const session = await auth();
        if (!session?.user?.email || !isAdmin(session.user.email)) {
            throw new Error("Unauthorized");
        }

        const db = await getDb();
        if (!db) throw new Error("No database");

        await db.delete(adopterFlags).where(eq(adopterFlags.id, flagId));
        revalidatePath('/admin/flags');
        return { success: true };
    } catch (error) {
        console.error("Dismiss flag error:", error);
        const errorId = logger.error('Dismiss flag failed', error, { flagId });
        throw new Error(`Failed to dismiss flag (Error ID: ${errorId})`);
    }
}

export async function removeVerification(adopterId: string, type: 'verified_identity' | 'verified_address') {
    try {
        const db = await getDb();
        if (!db) throw new Error("No database");
        const currentUser = await getUser();

        // Find and delete the verification flag
        const flag = await db.select().from(adopterFlags)
            .where(and(
                eq(adopterFlags.adopterId, adopterId),
                eq(adopterFlags.reason, type)
            ))
            .get();

        if (!flag) {
            return { success: false, error: "Flag not found" };
        }

        // Only the person who added the flag or an admin can remove it
        const session = await auth();
        const userIsAdmin = session?.user?.email && isAdmin(session.user.email);
        if (flag.flaggedBy !== currentUser && !userIsAdmin) {
            throw new Error("Unauthorized - only the person who added the verification or an admin can remove it");
        }

        await db.delete(adopterFlags).where(eq(adopterFlags.id, flag.id));

        // Log to audit history
        await db.insert(adopterHistory).values({
            id: crypto.randomUUID(),
            adopterId,
            changedBy: currentUser,
            changeType: 'flag_removed',
            fieldName: type,
            oldValue: flag.flaggedBy || null,
            changedAt: new Date()
        });

        return { success: true };
    } catch (error) {
        console.error("Remove verification error:", error);
        const errorId = logger.error('Remove verification failed', error, { adopterId, type });
        throw new Error(`Failed to remove verification (Error ID: ${errorId})`);
    }
}

// --- Dashboard & New Workflow Actions ---

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
        console.error("getMyAdopters error:", error);
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

        let query = db.select().from(adoptions);

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
                    .limit(4)
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
        console.error("getMyAdoptions error:", error);
        logger.error('getMyAdoptions failed', error);
        return [];
    }
}

export async function getAvailableAnimals() {
    try {
        const db = await getDb();
        if (!db) return [];
        const session = await auth();
        if (!session?.user?.email) return [];

        return await db.select().from(adoptions)
            .where(sql`${adoptions.addedBy} = ${session.user.email} AND ${adoptions.adopterId} IS NULL`);
        // We could add status check, but usually available animals are just unlinked.

    } catch (error) {
        console.error("getAvailableAnimals error:", error);
        logger.error('getAvailableAnimals failed', error);
        return [];
    }
}


import { isAdmin } from '@/config/admins';

export async function runAdminQuery(query: string) {
    try {
        const session = await auth();
        if (!session?.user?.email || !isAdmin(session.user.email)) {
            return { error: 'Unauthorized' };
        }

        const db = await getDb();
        if (!db) return { error: 'Database unavailable' };

        const q = query.trim();
        // Basic safety check: allow only SELECT
        if (!/^select/i.test(q)) {
            return { error: 'Only SELECT queries are allowed.' };
        }
        if (/insert|update|delete|drop|alter|create|truncate/i.test(q)) {
            return { error: 'Write operations are not allowed.' };
        }

        // Execute Raw Query
        // Drizzle D1/SQLite specific raw execution
        // We use sql.raw()
        const result = await db.run(sql.raw(q));

        // result for D1 with .run() usually returns { results: [], meta: ... } or just result depending on driver?
        // Wait, .run() is for execution. .all() is for fetching?
        // Let's try .all() if available, otherwise fallback.
        // Actually, drizzle-orm/sqlite-core doesn't always expose .all() on top level.
        // But we can try `db.all(sql.raw(q))` which is supported in many adapters.
        // If not, we might need `db.session.client.prepare(q).all()` which is driver specific.

        // Safer universal Drizzle way for raw select:
        // const res = await db.select().from(sql.raw(`(${q}) as t`)); 
        // But that wraps it.

        // Let's rely on `db.all(sql.raw(q))` for SQLite/D1.
        // If it fails, we catch it.

        // @ts-ignore - db.all exists on sqlite proxies usually
        const rows = await db.all(sql.raw(q));
        return { rows };

    } catch (e: any) {
        return { error: e.message };
    }
}

export async function deleteAdopter(adopterId: string) {
    const session = await auth();
    try {
        // Strict Admin Check
        if (!session?.user?.email || !isAdmin(session.user.email)) {
            return { success: false, error: "Unauthorized" };
        }

        const db = await getDb();
        if (!db) return { success: false, error: "No database" };

        // Get all adoption IDs for this adopter first (to delete their images)
        const adopterAdoptions = await db.select({ id: adoptions.id })
            .from(adoptions)
            .where(eq(adoptions.adopterId, adopterId));
        const adoptionIds = adopterAdoptions.map((a: { id: string }) => a.id);

        // Cascade Logic
        // 1. Delete adopter stats
        await db.delete(adopterStats).where(eq(adopterStats.adopterId, adopterId));

        // 2. Delete Flags
        await db.delete(adopterFlags).where(eq(adopterFlags.adopterId, adopterId));

        // 3. Delete History
        await db.delete(adopterHistory).where(eq(adopterHistory.adopterId, adopterId));

        // 4. Delete Adopter Images
        await db.delete(adopterImages).where(eq(adopterImages.adopterId, adopterId));

        // 5. Delete Adoption Images (for adoptions linked to this adopter)
        if (adoptionIds.length > 0) {
            await db.delete(adoptionImages).where(inArray(adoptionImages.adoptionId, adoptionIds));
        }

        // 6. Delete linked Adoptions entirely (rather than unlinking)
        await db.delete(adoptions).where(eq(adoptions.adopterId, adopterId));

        // 7. Delete Adopter
        await db.delete(adopters).where(eq(adopters.id, adopterId));

        logger.info('Adopter deleted', { adopterId, deletedBy: session.user.email });
        logAudit({ userEmail: session.user.email || undefined, action: 'adopter_deleted', target: adopterId });

        revalidatePath('/admin/adopters');
        return { success: true };
    } catch (error) {
        console.error("Delete adopter error:", error);
        logger.error('Delete adopter failed', error, { adopterId, user: session?.user?.email });
        return { success: false, error: error instanceof Error ? error.message : "Failed to delete adopter" };
    }
}

export async function purgeAllData(confirmationCode: string) {
    try {
        const session = await auth();
        // Strict Admin Check
        if (!session?.user?.email || !isAdmin(session.user.email)) {
            throw new Error("Unauthorized");
        }

        // Validate confirmation code matches expected pattern
        const expectedCode = "PURGE-ALL-DATA";
        if (confirmationCode !== expectedCode) {
            throw new Error("Invalid confirmation code");
        }

        const db = await getDb();
        if (!db) throw new Error("No database");

        // Delete all data in correct order to avoid foreign key issues
        // 1. Delete stats
        await db.delete(adopterStats);

        // 2. Delete flags
        await db.delete(adopterFlags);

        // 3. Delete history
        await db.delete(adopterHistory);

        // 4. Delete adoption images
        await db.delete(adoptionImages);

        // 5. Delete adopter images
        await db.delete(adopterImages);

        // 6. Delete adoptions
        await db.delete(adoptions);

        // 7. Delete searches
        await db.delete(searches);

        // 8. Delete adopters
        await db.delete(adopters);

        revalidatePath('/admin');
        revalidatePath('/');
        return { success: true, message: "All data has been purged" };
    } catch (error) {
        console.error("Purge all data error:", error);
        const errorId = logger.error('Purge all data failed', error);
        throw new Error(`Failed to purge data (Error ID: ${errorId})`);
    }
}

export async function getAdoptionConfig() {
    try {
        const db = await getDb();
        if (!db) return {
            threshold: 5,
            periodDays: 90,
            requestsThreshold: 3,
            requestsPeriodDays: 30
        };

        const configRows = await db.select().from(appConfig).all();
        const config: Record<string, string> = {};
        for (const row of configRows) {
            config[row.key] = row.value;
        }

        return {
            threshold: parseInt(config['too_many_adoptions_threshold'] || '5', 10),
            periodDays: parseInt(config['too_many_adoptions_period_days'] || '90', 10),
            requestsThreshold: parseInt(config['too_many_requests_threshold'] || '3', 10),
            requestsPeriodDays: parseInt(config['too_many_requests_period_days'] || '30', 10)
        };
    } catch (error) {
        console.error("Get adoption config error:", error);
        logger.error('Get adoption config failed', error);
        return {
            threshold: 5,
            periodDays: 90,
            requestsThreshold: 3,
            requestsPeriodDays: 30
        };
    }
}
