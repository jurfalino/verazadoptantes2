'use server';

import { getRequestContext } from '@cloudflare/next-on-pages';
import { createDb } from '@/db';
import { revalidatePath } from 'next/cache';
import { adopters, searches, adopterHistory, adoptions, adopterImages, adopterFlags, adopterStats, adoptionImages, appConfig } from '@/db/schema';
import { or, like, eq, sql, and, gte, isNull } from 'drizzle-orm';
import { auth } from '@/auth';
import { cookies } from 'next/headers';

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

export async function getDb() {
    console.log("[getDb] Starting database connection...");
    try {
        const { env } = getRequestContext();
        console.log("[getDb] Got request context, env:", env ? "exists" : "null");
        console.log("[getDb] env.DB:", env?.DB ? "exists" : "null");
        if (env && env.DB) {
            console.log("[getDb] Using D1 database");
            const db = await createDb(env.DB);
            console.log("[getDb] D1 database created successfully");
            return db;
        } else {
            console.log("[getDb] D1 not available, env.DB is null");
        }
    } catch (e) {
        console.log("[getDb] getRequestContext failed:", e instanceof Error ? e.message : String(e));
        // Ignore error - we are likely local
    }

    // Fallback for local development
    console.log("[getDb] Checking local fallback...");
    if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
        console.log("[getDb] Attempting local DB...");
        try {
            const { createLocalDb } = await import('@/db/local');
            return await createLocalDb('local.db');
        } catch (e) {
            console.error("[getDb] Local DB Init Error:", e);
        }
    } else {
        console.log("[getDb] Skipping local DB - in production without D1");
    }
    console.log("[getDb] Returning undefined - no database available");
    return undefined;
}

export async function getUser() {
    try {
        const session = await auth();
        console.log("getUser Session:", session?.user?.email);
        if (session?.user?.email) return `User: ${session.user.email}`;
    } catch (e) {
        console.error("getUser Auth Error:", e);
        // Auth failed
    }

    const cookieStore = await cookies();
    const isAnon = cookieStore.get("anon_user");
    if (isAnon) return 'Anon: Guest';

    return 'Unknown';
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

export async function searchAdopter(query: string): Promise<SearchResult[]> {
    try {
        const db = await getDb();
        if (!db) return [];

        // Normalize query
        const normalizedQuery = query.trim();
        if (!normalizedQuery) return [];

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
                like(adopters.addressInfo, `%${normalizedQuery}%`),
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
                .where(sql`id IN ${Array.from(extraIds)}`);
        }

        // Combine Results
        const allProfiles = [...directResults, ...extraProfiles];
        const adopterIds = allProfiles.map(a => a.id);

        if (adopterIds.length === 0) return [];

        // Fetch enrichment data in parallel
        const adoptionConfig = await getAdoptionConfig();
        const [allAdoptions, allAdoptionRecords, allFlags, allStats, allImages] = await Promise.all([
            // Average ratings from adoptions
            db.select({
                adopterId: adoptions.adopterId,
                avgRating: sql<number>`AVG(${adoptions.rating})`,
                adoptionCount: sql<number>`COUNT(*)`
            })
                .from(adoptions)
                .where(sql`${adoptions.adopterId} IN ${adopterIds}`)
                .groupBy(adoptions.adopterId),
            // All adoption records (for counting within period)
            db.select({
                adopterId: adoptions.adopterId,
                recordType: adoptions.recordType,
                date: adoptions.date
            })
                .from(adoptions)
                .where(sql`${adoptions.adopterId} IN ${adopterIds}`),
            // Flags
            db.select({
                adopterId: adopterFlags.adopterId,
                reason: adopterFlags.reason
            })
                .from(adopterFlags)
                .where(sql`${adopterFlags.adopterId} IN ${adopterIds}`),
            // Stats (all-time counts)
            db.select({
                adopterId: adopterStats.adopterId,
                eventType: adopterStats.eventType,
                count: sql<number>`COUNT(*)`
            })
                .from(adopterStats)
                .where(sql`${adopterStats.adopterId} IN ${adopterIds}`)
                .groupBy(adopterStats.adopterId, adopterStats.eventType),
            // Profile images (for thumbnails)
            db.select({
                adopterId: adopterImages.adopterId,
                url: adopterImages.url,
                isProfilePicture: adopterImages.isProfilePicture
            })
                .from(adopterImages)
                .where(and(
                    sql`${adopterImages.adopterId} IN ${adopterIds}`,
                    isNull(adopterImages.adoptionId)
                ))
                .orderBy(sql`${adopterImages.isProfilePicture} DESC, ${adopterImages.uploadedAt} DESC`)
        ]);

        // Build lookup maps
        const adoptionMap = new Map<string, { avgRating: number | null; count: number }>();
        for (const a of allAdoptions) {
            if (a.adopterId) {
                adoptionMap.set(a.adopterId, { avgRating: a.avgRating, count: a.adoptionCount });
            }
        }

        // Build flags map with detailed flag data
        const flagsMap = new Map<string, AdopterFlags>();
        for (const f of allFlags) {
            const existing = flagsMap.get(f.adopterId) || {
                inaccurate: false,
                duplicate: false,
                verified_identity: false,
                verified_address: false,
                tooManyAdoptions: null,
                tooManyRequests: null
            };
            if (f.reason === 'verified_identity') existing.verified_identity = true;
            else if (f.reason === 'verified_address') existing.verified_address = true;
            else if (f.reason === 'inaccurate_information') existing.inaccurate = true;
            else if (f.reason === 'duplicate') existing.duplicate = true;
            flagsMap.set(f.adopterId, existing);
        }

        // Calculate too many adoptions/requests per adopter
        const adoptionsCutoff = new Date();
        adoptionsCutoff.setDate(adoptionsCutoff.getDate() - adoptionConfig.periodDays);
        const requestsCutoff = new Date();
        requestsCutoff.setDate(requestsCutoff.getDate() - adoptionConfig.requestsPeriodDays);

        for (const rec of allAdoptionRecords) {
            if (!rec.adopterId) continue;
            const flags = flagsMap.get(rec.adopterId) || {
                inaccurate: false,
                duplicate: false,
                verified_identity: false,
                verified_address: false,
                tooManyAdoptions: null,
                tooManyRequests: null
            };

            const recDate = rec.date ? (typeof rec.date === 'number' ? new Date(rec.date * 1000) : new Date(rec.date)) : null;
            if (!recDate) continue;

            if (rec.recordType === 'adoption' && recDate >= adoptionsCutoff) {
                if (!flags.tooManyAdoptions) {
                    flags.tooManyAdoptions = { count: 0, threshold: adoptionConfig.threshold, periodDays: adoptionConfig.periodDays };
                }
                flags.tooManyAdoptions.count++;
            }
            if (rec.recordType === 'adoption_request' && recDate >= requestsCutoff) {
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
            flagsMap.set(adopterId, flags);
        }

        const statsMap = new Map<string, { searchHits: number; profileViews: number; requests: number; adoptions: number }>();
        for (const s of allStats) {
            const existing = statsMap.get(s.adopterId) || { searchHits: 0, profileViews: 0, requests: 0, adoptions: 0 };
            if (s.eventType === 'search_hit') existing.searchHits = s.count;
            else if (s.eventType === 'profile_view') existing.profileViews = s.count;
            else if (s.eventType === 'adoption_request') existing.requests = s.count;
            else if (s.eventType === 'adoption_completed') existing.adoptions = s.count;
            statsMap.set(s.adopterId, existing);
        }

        // Build thumbnail map (first image per adopter, prioritizing profile pictures)
        const thumbnailMap = new Map<string, string>();
        for (const img of allImages) {
            // Only set if not already set (since we ordered by isProfilePicture DESC, uploadedAt DESC)
            if (!thumbnailMap.has(img.adopterId)) {
                thumbnailMap.set(img.adopterId, img.url);
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
        return allProfiles.map(a => {
            // Determine match context
            let context = "";
            const qLower = normalizedQuery.toLowerCase();

            const basicMatch =
                (a.name?.toLowerCase().includes(qLower)) ||
                (a.contactInfo?.toLowerCase().includes(qLower)) ||
                (a.addressInfo?.toLowerCase().includes(qLower));

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

    } catch (error) {
        console.error("Search error:", error);
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to search adopters: ${message}`);
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

            const fields = ['name', 'contactInfo', 'addressInfo', 'status', 'familyMembers'] as const;
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
            return { success: true, id: newId };
        }

    } catch (error) {
        console.error("Save adopter error:", error);
        throw new Error(`Failed to save adopter: ${error instanceof Error ? error.message : String(error)}`);
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
        throw new Error("Failed to save image");
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
        throw new Error("Failed to set profile picture");
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
                    if (adopter && adopter.addressInfo !== data.verifiedAddress) {
                        await db.update(adopters).set({ addressInfo: data.verifiedAddress }).where(eq(adopters.id, data.adopterId));

                        // Log address change in audit history
                        await db.insert(adopterHistory).values({
                            id: crypto.randomUUID(),
                            adopterId: data.adopterId,
                            changedBy,
                            changes: JSON.stringify({
                                addressInfo: {
                                    from: adopter.addressInfo || '(empty)',
                                    to: data.verifiedAddress,
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

            return { success: true, id };
        }
    } catch (error) {
        console.error("Save adoption error:", error);
        throw new Error("Failed to save adoption");
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

        revalidatePath(`/adopter/${adopterId}`);
        return { success: true };
    } catch (error) {
        console.error("Delete adoption error:", error);
        throw new Error("Failed to delete adoption");
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
        throw new Error("Failed to delete image");
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

        return { success: true, id };
    } catch (error) {
        console.error("Flag adopter error:", error);
        throw new Error("Failed to flag adopter");
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
        throw new Error("Failed to dismiss flag");
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
        throw new Error("Failed to remove verification");
    }
}

// --- Dashboard & New Workflow Actions ---

export async function getMyAdopters(sort: 'date' | 'name' = 'date') {
    try {
        const db = await getDb();
        if (!db) return [];

        const session = await auth();
        if (!session?.user?.email) return [];

        const userIdentifier = `User: ${session.user.email}`;

        const query = db.select().from(adopters)
            .where(eq(adopters.addedBy, userIdentifier));

        if (sort === 'name') {
            query.orderBy(adopters.name);
        } else {
            query.orderBy(sql`${adopters.createdAt} DESC`);
        }

        const adoptersList = await query.all();

        // Get adoption config for threshold calculations
        const adoptionConfig = await getAdoptionConfig();
        const adoptionsCutoff = new Date();
        adoptionsCutoff.setDate(adoptionsCutoff.getDate() - adoptionConfig.periodDays);
        const requestsCutoff = new Date();
        requestsCutoff.setDate(requestsCutoff.getDate() - adoptionConfig.requestsPeriodDays);

        // Fetch additional data for each adopter in parallel
        const enrichedAdopters = await Promise.all(adoptersList.map(async (adopter: typeof adopters.$inferSelect) => {
            // Get average rating from adoptions (only completed adoptions)
            const avgResult = await db.select({
                avgRating: sql<number>`AVG(${adoptions.rating})`
            }).from(adoptions).where(and(
                eq(adoptions.adopterId, adopter.id),
                eq(adoptions.recordType, 'adoption')
            )).get();

            // Get profile picture first, or fall back to most recent image
            let profileImage = await db.select().from(adopterImages)
                .where(and(
                    eq(adopterImages.adopterId, adopter.id),
                    isNull(adopterImages.adoptionId),
                    eq(adopterImages.isProfilePicture, 1)
                ))
                .limit(1)
                .all();

            // Fallback to most recent if no profile picture set
            if (profileImage.length === 0) {
                profileImage = await db.select().from(adopterImages)
                    .where(and(
                        eq(adopterImages.adopterId, adopter.id),
                        isNull(adopterImages.adoptionId)
                    ))
                    .orderBy(sql`${adopterImages.uploadedAt} DESC`)
                    .limit(1)
                    .all();
            }

            // Get flags summary
            const flags = await db.select({
                reason: adopterFlags.reason
            }).from(adopterFlags)
                .where(eq(adopterFlags.adopterId, adopter.id))
                .all();

            // Get adoption count (recordType = 'adoption')
            const adoptionCountResult = await db.select({
                count: sql<number>`COUNT(*)`
            }).from(adoptions)
                .where(and(
                    eq(adoptions.adopterId, adopter.id),
                    eq(adoptions.recordType, 'adoption')
                ))
                .get();

            // Get request count (recordType = 'adoption_request')
            const requestCountResult = await db.select({
                count: sql<number>`COUNT(*)`
            }).from(adoptions)
                .where(and(
                    eq(adoptions.adopterId, adopter.id),
                    eq(adoptions.recordType, 'adoption_request')
                ))
                .get();

            // Get stats (search hits and profile views)
            const statsResults = await db.select({
                eventType: adopterStats.eventType,
                count: sql<number>`COUNT(*)`
            }).from(adopterStats)
                .where(eq(adopterStats.adopterId, adopter.id))
                .groupBy(adopterStats.eventType)
                .all();

            const stats = { searchHits: 0, profileViews: 0 };
            for (const s of statsResults) {
                if (s.eventType === 'search_hit') stats.searchHits = s.count;
                else if (s.eventType === 'profile_view') stats.profileViews = s.count;
            }

            // Get all adoption records for this adopter (for period calculations)
            const adopterAdoptions = await db.select({
                recordType: adoptions.recordType,
                date: adoptions.date
            }).from(adoptions)
                .where(eq(adoptions.adopterId, adopter.id))
                .all();

            // Calculate adoptions/requests in period
            let adoptionsInPeriod = 0;
            let requestsInPeriod = 0;
            for (const a of adopterAdoptions) {
                const aDate = a.date ? (typeof a.date === 'number' ? new Date(a.date * 1000) : new Date(a.date)) : null;
                if (!aDate) continue;
                if (a.recordType === 'adoption' && aDate >= adoptionsCutoff) adoptionsInPeriod++;
                if (a.recordType === 'adoption_request' && aDate >= requestsCutoff) requestsInPeriod++;
            }

            // Build flags object
            const flagsObj: AdopterFlags = {
                inaccurate: flags.some((f: { reason: string }) => f.reason === 'inaccurate_information'),
                duplicate: flags.some((f: { reason: string }) => f.reason === 'duplicate'),
                verified_identity: flags.some((f: { reason: string }) => f.reason === 'verified_identity'),
                verified_address: flags.some((f: { reason: string }) => f.reason === 'verified_address'),
                tooManyAdoptions: adoptionsInPeriod >= adoptionConfig.threshold
                    ? { count: adoptionsInPeriod, threshold: adoptionConfig.threshold, periodDays: adoptionConfig.periodDays }
                    : null,
                tooManyRequests: requestsInPeriod >= adoptionConfig.requestsThreshold
                    ? { count: requestsInPeriod, threshold: adoptionConfig.requestsThreshold, periodDays: adoptionConfig.requestsPeriodDays }
                    : null
            };

            return {
                ...adopter,
                avgRating: avgResult?.avgRating ?? null,
                thumbnail: profileImage[0]?.url ?? null,
                flags: flagsObj,
                adoptionCount: adoptionCountResult?.count ?? 0,
                requestCount: requestCountResult?.count ?? 0,
                searchHits: stats.searchHits,
                profileViews: stats.profileViews
            };
        }));

        return enrichedAdopters;
    } catch (error) {
        console.error("getMyAdopters error:", error);
        return [];
    }
}

export async function getMyAdoptions(filter: 'all' | 'adoption' | 'adoption_request' | 'observation' | 'follow_up' | 'returned_pet' = 'all', sort: 'date' | 'name' = 'date') {
    try {
        const db = await getDb();
        if (!db) return [];
        const session = await auth();
        if (!session?.user?.email) return [];

        const userIdentifier = `User: ${session.user.email}`;

        let query = db.select().from(adoptions);

        // Apply filters by recordType
        if (filter !== 'all') {
            query.where(sql`${adoptions.addedBy} = ${userIdentifier} AND ${adoptions.recordType} = ${filter}`);
        } else {
            query.where(eq(adoptions.addedBy, userIdentifier));
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
        return [];
    }
}

export async function getAvailableAnimals() {
    try {
        const db = await getDb();
        if (!db) return [];
        const session = await auth();
        if (!session?.user?.email) return [];

        const userIdentifier = `User: ${session.user.email}`;

        // Animals added by me, that are NOT yet linked to an adopter (adopterId is NULL)
        // AND status is not 'completed' ? Or just any unlinked animal?
        // Requirement: "list all animals under adoption that have already been added by the user and not marked as completed"
        // Wait, "not marked as completed" usually refers to the status of the adoption process.
        // If adopterId is NULL, it's effectively "Available".
        // Let's also check status != 'completed' if that field is used for lifecycle.

        return await db.select().from(adoptions)
            .where(sql`${adoptions.addedBy} = ${userIdentifier} AND ${adoptions.adopterId} IS NULL`);
        // We could add status check, but usually available animals are just unlinked.

    } catch (error) {
        console.error("getAvailableAnimals error:", error);
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
    try {
        const session = await auth();
        // Strict Admin Check
        if (!session?.user?.email || !isAdmin(session.user.email)) {
            throw new Error("Unauthorized");
        }

        const db = await getDb();
        if (!db) throw new Error("No database");

        // Cascade Logic
        // 1. Delete Flags
        await db.delete(adopterFlags).where(eq(adopterFlags.adopterId, adopterId));

        // 2. Delete History
        await db.delete(adopterHistory).where(eq(adopterHistory.adopterId, adopterId));

        // 3. Delete Images
        // Ideally we should delete from storage (S3/R2) too, but here we only have DB URLs.
        await db.delete(adopterImages).where(eq(adopterImages.adopterId, adopterId));

        // 4. Unlink Adoptions (Set adopterId = NULL) to make animals available again
        await db.update(adoptions)
            .set({ adopterId: null, status: 'available' }) // Reset status too if needed
            .where(eq(adoptions.adopterId, adopterId));

        // 5. Delete Adopter
        await db.delete(adopters).where(eq(adopters.id, adopterId));

        revalidatePath('/admin/adopters');
        return { success: true };
    } catch (error) {
        console.error("Delete adopter error:", error);
        throw new Error("Failed to delete adopter");
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
        throw new Error("Failed to purge data: " + (error instanceof Error ? error.message : "Unknown error"));
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
        return {
            threshold: 5,
            periodDays: 90,
            requestsThreshold: 3,
            requestsPeriodDays: 30
        };
    }
}
