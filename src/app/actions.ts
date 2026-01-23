'use server';

import { getRequestContext } from '@cloudflare/next-on-pages';
import { createDb } from '@/db';
import { adopters, searches, adopterHistory, adoptions, adopterImages, adopterFlags } from '@/db/schema';
import { or, like, eq, sql } from 'drizzle-orm';
import { auth } from '@/auth';
import { cookies } from 'next/headers';

export interface SearchResult {
    adopter: typeof adopters.$inferSelect;
    historyCount: number; // Placeholder for now
}

async function getDb() {
    let db;
    try {
        const { env } = getRequestContext();
        if (env && env.DB) {
            db = createDb(env.DB);
        }
    } catch (e) {
        // Ignore error
    }

    if (!db) {
        const { createLocalDb } = await import('@/db');
        db = createLocalDb('local.db');
    }
    return db;
}

async function getUser() {
    const session = await auth();
    if (session?.user?.email) return `User: ${session.user.email}`;

    const cookieStore = await cookies();
    const isAnon = cookieStore.get("anon_user");
    if (isAnon) return 'Anon: Guest';

    return 'Unknown';
}


export async function searchAdopter(query: string): Promise<SearchResult[]> {
    try {
        const db = await getDb();
        if (!db) return [];

        // Normalize query
        const normalizedQuery = query.trim();
        if (!normalizedQuery) return [];

        // Log the search
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
        } catch (e) {
            console.error("Failed to log search", e);
        }

        // Perform Search
        const results = await db.select().from(adopters).where(
            or(
                like(adopters.name, `%${normalizedQuery}%`),
                like(adopters.contactInfo, `%${normalizedQuery}%`),
                like(adopters.addressInfo, `%${normalizedQuery}%`)
            )
        ).limit(20);

        // Map to result type
        return results.map(a => ({
            adopter: a,
            historyCount: 0 // TODO: Fetch adoption history count
        }));

    } catch (error) {
        console.error("Search error:", error);
        throw new Error("Failed to search adopters");
    }
}

export async function getAdopter(id: string) {
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

            const fields = ['name', 'contactInfo', 'addressInfo', 'status'] as const;
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
        throw new Error("Failed to save adopter");
    }
}

export async function saveImage(adopterId: string, url: string, caption?: string) {
    try {
        const db = await getDb();
        if (!db) throw new Error("No database");

        const id = crypto.randomUUID();
        await db.insert(adopterImages).values({
            id,
            adopterId,
            url,
            caption: caption || null,
            uploadedAt: new Date()
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
        const addedBy = await getUser();

        const id = crypto.randomUUID();
        await db.insert(adoptions).values({
            ...data,
            id,
            date: new Date(),
            addedBy
        });

        return { success: true, id };
    } catch (error) {
        console.error("Save adoption error:", error);
        throw new Error("Failed to save adoption");
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
