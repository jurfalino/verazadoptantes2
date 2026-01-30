'use server';

import { getRequestContext } from '@cloudflare/next-on-pages';
import { createDb } from '@/db';
import { revalidatePath } from 'next/cache';
import { adopters, searches, adopterHistory, adoptions, adopterImages, adopterFlags } from '@/db/schema';
import { or, like, eq, sql } from 'drizzle-orm';
import { auth } from '@/auth';
import { cookies } from 'next/headers';

export interface SearchResult {
    adopter: typeof adopters.$inferSelect;
    historyCount: number; // Placeholder for now
    matchContext?: string;
}

async function getDb() {
    try {
        const { env } = getRequestContext();
        if (env && env.DB) {
            return createDb(env.DB);
        }
    } catch (e) {
        // Ignore error
    }

    // Fallback for local development (npm run dev)
    try {
        const { createLocalDb } = await import('@/db/local');
        return await createLocalDb('local.db');
    } catch (e) {
        console.error("Local DB Init Error:", e);
        // This is expected in Edge runtime if better-sqlite3 is excluded
    }
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
        directResults.forEach(r => extraIds.delete(r.id));

        // Fetch profiles for extra IDs
        let extraProfiles: typeof adopters.$inferSelect[] = [];
        if (extraIds.size > 0) {
            extraProfiles = await db.select().from(adopters)
                .where(sql`id IN ${Array.from(extraIds)}`);
        }

        // Combine Results
        const allProfiles = [...directResults, ...extraProfiles];

        // Map to result type with context hints
        return allProfiles.map(a => {
            // Determine match context
            let context = "";
            const qLower = normalizedQuery.toLowerCase();

            // Priority 1: Direct Match (if not obvious)
            // If name/contact/address don't match, check family
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

            return {
                adopter: a,
                historyCount: 0,
                matchContext: context // Pass this to UI
            };
        });

    } catch (error) {
        console.error("Search error:", error);
        throw new Error("Failed to search adopters");
    }
}

export async function getAdopter(id: string) {
    // ... existing ...
    try {
        const db = await getDb();
        if (!db) return null;
        return await db.select().from(adopters).where(eq(adopters.id, id)).get();
    } catch (error) {
        console.error("Get adopter error:", error);
        return null;
    }
}

export async function saveAdopter(data: typeof adopters.$inferInsert) {
    try {
        const db = await getDb();
        if (!db) throw new Error("No database");
        const changedBy = await getUser();

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

export async function saveImage(adopterId: string, url: string, caption?: string) {
    try {
        const db = await getDb();
        if (!db) throw new Error("No database");
        const addedBy = await getUser();

        const id = crypto.randomUUID();
        await db.insert(adopterImages).values({
            id,
            adopterId,
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
        return await db.select().from(adopterImages)
            .where(eq(adopterImages.adopterId, adopterId))
            .orderBy(sql`${adopterImages.uploadedAt} DESC`)
            .all();
    } catch (error) {
        console.error("Get images error:", error);
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
            // Calculate changes
            const changes: Record<string, any> = {};
            let hasChanges = false;

            const fields = ['animalName', 'species', 'status', 'rating', 'details'] as const;
            for (const field of fields) {
                // @ts-ignore
                if (data[field] !== undefined && data[field] !== existing[field]) {
                    // @ts-ignore
                    changes[field] = { from: existing[field], to: data[field] };
                    hasChanges = true;
                }
            }

            if (hasChanges) {
                // Update adoption
                await db.update(adoptions).set(data).where(eq(adoptions.id, data.id as string));

                // Log to adopter history
                await db.insert(adopterHistory).values({
                    id: crypto.randomUUID(),
                    adopterId: data.adopterId,
                    changedBy,
                    changes: JSON.stringify({ adoption_updated: changes }),
                    changedAt: new Date()
                });
            }
            revalidatePath(`/adopter/${data.adopterId}`);
            return { success: true, id: data.id };
        } else {
            // Create new adoption
            const id = crypto.randomUUID();
            await db.insert(adoptions).values({
                ...data,
                id,
                date: new Date(),
                addedBy: changedBy
            });

            // Log to adopter history
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

            revalidatePath(`/adopter/${data.adopterId}`);
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
            .where(eq(adopterFlags.adopterId, adopterId)) // Fix: filter by adopterId, not createdAt
            .orderBy(sql`${adopterFlags.createdAt} DESC`)
            .all();
    } catch (error) {
        console.error("Get flags error:", error);
        return [];
    }
}
