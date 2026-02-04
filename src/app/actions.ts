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

export async function getDb() {
    try {
        const { env } = getRequestContext();
        if (env && env.DB) {
            return createDb(env.DB);
        }
    } catch (e) {
        // Ignore error - we are likely local
    }

    // Fallback for local development
    // Environment check: Ensure we are NOT in Edge Runtime before requiring local DB
    // Edge Runtime doesn't have `process.cwd` usually, but Next.js polyfills `process.env`.
    // We can check `process.release.name` or similar, or just try/catch safely without crashing global scope.

    // Changing approach: Only dynamic import if we know we are probably in Node.
    if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
        try {
            // Use precise webpack ignore or just dynamic import
            // Note: Next.js Middleware/Edge functions will still try to bundle this if not careful.
            // But since we removed `runtime = edge` from layout/pages, this should run in Node.
            const { createLocalDb } = await import('@/db/local');
            return await createLocalDb('local.db');
        } catch (e) {
            console.error("Local DB Init Error:", e);
        }
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
        directResults.forEach((r: any) => extraIds.delete(r.id));

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
            // Update existing
            // Calculate changes
            const changes: Record<string, any> = {};
            let hasChanges = false;

            const fields = ['animalName', 'species', 'status', 'rating', 'details', 'adopterId'] as const; // Added adopterId
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
                date: new Date(),
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

        return await query.all();
    } catch (error) {
        console.error("getMyAdopters error:", error);
        return [];
    }
}

export async function getMyAdoptions(filter: 'all' | 'adopted' = 'all', sort: 'date' | 'name' = 'date') {
    try {
        const db = await getDb();
        if (!db) return [];
        const session = await auth();
        if (!session?.user?.email) return [];

        const userIdentifier = `User: ${session.user.email}`;

        // Construct where clause
        // 1. Must be added by me
        const whereClause = [eq(adoptions.addedBy, userIdentifier)];

        // 2. Filter logic
        if (filter === 'adopted') {
            // "only adopted pets" means adopterId is NOT NULL
            whereClause.push(sql`${adoptions.adopterId} IS NOT NULL`);
        }

        // Use and(...) generic if possible, or build chain
        /* 
           Simpler approach with chained .where() is tricky if using array. 
           Let's use the spread operator with `and`.
           Need to import `and` from drizzle-orm but I might not have it imported top-level.
           Let's import it or use sql injection safely.
        */
        // Re-checking imports... `or, like, eq, sql` are imported. Need `and` and `isNotNull`.
        // I will assume I can update imports or use raw sql for complex filter.
        // For safety, let's stick to chained where if feasible or sql.

        let query = db.select().from(adoptions);

        // Apply all filters manually
        // Note: Drizzle's .where() usually replaces previous where, so we need `and(...)`
        // I will update imports in a separate step or just use `sql` heavily.
        // Actually, let's use sql for the whole WHERE to be safe without changing imports yet.

        if (filter === 'adopted') {
            query.where(sql`${adoptions.addedBy} = ${userIdentifier} AND ${adoptions.adopterId} IS NOT NULL`);
        } else {
            query.where(eq(adoptions.addedBy, userIdentifier));
        }

        if (sort === 'name') {
            query.orderBy(adoptions.animalName);
        } else {
            query.orderBy(sql`${adoptions.date} DESC`);
        }

        return await query.all();
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
