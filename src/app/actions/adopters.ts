'use server';

import { adopters, adopterHistory, adopterStats } from '@/db/schema';
import { eq, sql } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { getDb, getUser } from './_db';

export async function getAdopter(id: string) {
    try {
        const db = await getDb();
        if (!db) return null;

        // Log profile view (fire and forget)
        logProfileView(id).catch((e) => { logger.warn('Fire-and-forget profile view failed', { adopterId: id, error: e instanceof Error ? e.message : String(e) }); });

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

        const { adoptions } = await import('@/db/schema');
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
