'use server';

import { adopters, adopterHistory, adopterStats } from '@/db/schema';
import { eq, sql, and } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { getDb, getUser } from './_db';
import { NINETY_DAYS_IN_SECONDS, ONE_YEAR_IN_SECONDS, ADMIN_STATS_EXCLUSION_SQL } from '@/config/constants';
import { tokenizeAdopter } from './duplicates';
import { saveAdopterSchema } from './validation';

export async function getAdopter(id: string) {
    try {
        const db = await getDb();
        if (!db) return null;

        // Log profile view with actor (fire and forget)
        let user = 'unknown';
        try { user = await getUser(); } catch { /* anonymous */ }
        logProfileView(id, user).catch((e) => { logger.warn('Fire-and-forget profile view failed', { adopterId: id, error: e instanceof Error ? e.message : String(e) }); });

        return await db.select().from(adopters).where(eq(adopters.id, id)).get();
    } catch (error) {
        logger.error('Get adopter failed', error, { adopterId: id });
        return null;
    }
}

export async function saveAdopter(data: typeof adopters.$inferInsert) {
    // Validate input
    const parsed = saveAdopterSchema.safeParse(data);
    if (!parsed.success) {
        throw new Error(`Invalid adopter data: ${parsed.error.issues.map(i => i.message).join(', ')}`);
    }

    try {
        const db = await getDb();
        if (!db) {
            throw new Error("No database");
        }

        let changedBy = 'Unknown';
        try {
            changedBy = await getUser();
        } catch (e) {
            logger.warn('getUser failed during adopter save', { error: e instanceof Error ? e.message : String(e) });
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
                // Optimistic locking: only update if the record hasn't been modified since we read it
                const result = await db.update(adopters).set({
                    ...data,
                    updatedAt: new Date()
                }).where(
                    and(
                        eq(adopters.id, data.id as string),
                        eq(adopters.updatedAt, existing.updatedAt!)
                    )
                );

                // Check if update succeeded (no concurrent modification)
                const rowsAffected = (result as unknown as { rowsAffected?: number }).rowsAffected ?? 1;
                if (rowsAffected === 0) {
                    throw new Error('This record was modified by another user. Please refresh and try again.');
                }

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

                // Fire-and-forget: update duplicate detection tokens
                tokenizeAdopter(data.id as string).catch(e => { logger.warn('Tokenize adopter failed (fire-and-forget)', { adopterId: data.id, error: e instanceof Error ? e.message : String(e) }); });
            }
            return { success: true, id: data.id };
        } else {
            // Create
            const newId = data.id || crypto.randomUUID();

            // Look up the user's country to stamp on the adopter
            let userCountry: string | null = null;
            try {
                const { env } = (await import('@cloudflare/next-on-pages')).getRequestContext();
                if (env?.DB) {
                    const row = await env.DB.prepare(
                        `SELECT up.country FROM user_profiles up JOIN user u ON u.id = up.user_id WHERE u.email = ? LIMIT 1`
                    ).bind(changedBy).first<{ country: string | null }>();
                    userCountry = row?.country || null;
                }
            } catch { /* best-effort */ }

            await db.insert(adopters).values({
                ...data,
                id: newId,
                addedBy: changedBy, // Added this line
                country: userCountry,
                createdAt: new Date(),
                updatedAt: new Date()
            });

            logger.info('Adopter created', { adopterId: newId, changedBy });
            logAudit({ userEmail: changedBy, action: 'adopter_created', target: newId, details: { name: data.name } });

            // Fire-and-forget: generate duplicate detection tokens
            tokenizeAdopter(newId).catch(e => { logger.warn('Tokenize adopter failed (fire-and-forget)', { adopterId: newId, error: e instanceof Error ? e.message : String(e) }); });

            return { success: true, id: newId };
        }

    } catch (error) {
        const errorId = logger.error('Save adopter failed', error, { adopterId: data.id });
        throw new Error(`Failed to save adopter (Error ID: ${errorId})`);
    }
}

// Fetch adopter stats for different time periods (aggregated in SQL)
export async function getAdopterStats(adopterId: string) {
    try {
        const db = await getDb();
        if (!db) return null;

        const now = Math.floor(Date.now() / 1000); // Unix timestamp in seconds
        const ninetyDaysAgo = now - NINETY_DAYS_IN_SECONDS;
        const oneYearAgo = now - ONE_YEAR_IN_SECONDS;

        // Aggregate in SQL: returns at most 2 rows (one per event type: search_hit, profile_view)
        // Note: adoption/request counts come from the adoptions table, not from stats events
        // Exclude admin activity: filter out events from users with role='admin' in user_profiles
        const rows = await db.select({
            eventType: adopterStats.eventType,
            total: sql<number>`COUNT(*)`,
            last90d: sql<number>`SUM(CASE WHEN CAST(strftime('%s', ${adopterStats.createdAt}) AS INTEGER) >= ${ninetyDaysAgo} THEN 1 ELSE 0 END)`,
            last1y: sql<number>`SUM(CASE WHEN CAST(strftime('%s', ${adopterStats.createdAt}) AS INTEGER) >= ${oneYearAgo} THEN 1 ELSE 0 END)`,
        }).from(adopterStats)
            .where(and(
                eq(adopterStats.adopterId, adopterId),
                sql`(${adopterStats.userId} IS NULL OR ${adopterStats.userId} NOT IN (${sql.raw(ADMIN_STATS_EXCLUSION_SQL)}))`
            ))
            .groupBy(adopterStats.eventType);

        // Map SQL results to the expected shape
        const stats = {
            searchHits: { '90d': 0, '1y': 0, 'all': 0 },
            profileViews: { '90d': 0, '1y': 0, 'all': 0 },
        };

        const bucketMap: Record<string, keyof typeof stats> = {
            'search_hit': 'searchHits',
            'profile_view': 'profileViews',
        };

        for (const row of rows) {
            const bucket = row.eventType ? bucketMap[row.eventType] : undefined;
            if (bucket) {
                stats[bucket].all = row.total || 0;
                stats[bucket]['1y'] = row.last1y || 0;
                stats[bucket]['90d'] = row.last90d || 0;
            }
        }

        return stats;
    } catch (error) {
        logger.error('Get adopter stats failed', error, { adopterId });
        return null;
    }
}

// Log a profile view event
export async function logProfileView(adopterId: string, userId?: string) {
    try {
        const db = await getDb();
        if (!db) return;

        await db.insert(adopterStats).values({
            id: crypto.randomUUID(),
            adopterId,
            eventType: 'profile_view',
            userId: userId || null,
            createdAt: new Date()
        });
    } catch (error) {
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
        logger.error('Get history failed', error, { adopterId });
        return [];
    }
}
