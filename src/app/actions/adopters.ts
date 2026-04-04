'use server';

import { adopters, adopterHistory, adopterStats } from '@/db/schema';
import { eq, sql, and } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { getDb, getUser } from './_db';
import { ADMIN_STATS_EXCLUSION_SQL } from '@/config/constants';
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

// Fetch adopter stats — flat totals (no period bucketing)
export async function getAdopterStats(adopterId: string) {
    try {
        const db = await getDb();
        if (!db) return null;

        // Aggregate in SQL: returns at most 2 rows (one per event type: search_hit, profile_view)
        // Exclude admin activity: filter out events from users with role='admin' in user_profiles
        const rows = await db.select({
            eventType: adopterStats.eventType,
            total: sql<number>`COUNT(*)`,
        }).from(adopterStats)
            .where(and(
                eq(adopterStats.adopterId, adopterId),
                sql`(${adopterStats.userId} IS NULL OR ${adopterStats.userId} NOT IN (${sql.raw(ADMIN_STATS_EXCLUSION_SQL)}))`
            ))
            .groupBy(adopterStats.eventType);

        const stats = { searchHits: 0, profileViews: 0 };

        for (const row of rows) {
            if (row.eventType === 'search_hit') stats.searchHits = row.total || 0;
            else if (row.eventType === 'profile_view') stats.profileViews = row.total || 0;
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
        }).from(adoptions).where(
            eq(adoptions.adopterId, adopterId)
        ).get();

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

export async function getLinkedFormSubmissions(adopterId: string) {
    try {
        const db = await getDb();
        if (!db) return [];
        const { formSubmissions } = await import('@/db/schema');
        return await db.select({
            id: formSubmissions.id,
            species: formSubmissions.species,
            lifeStage: formSubmissions.lifeStage,
            notificationId: formSubmissions.notificationId,
            answersJson: formSubmissions.answersJson,
            createdAt: formSubmissions.createdAt,
        }).from(formSubmissions)
            .where(eq(formSubmissions.linkedAdopterId, adopterId))
            .orderBy(sql`${formSubmissions.createdAt} DESC`)
            .all();
    } catch (error) {
        logger.error('Get linked form submissions failed', error, { adopterId });
        return [];
    }
}

// ── Adopter Deletion ─────────────────────────────────────────

export async function checkAdopterDeletable(adopterId: string) {
    try {
        const db = await getDb();
        if (!db) return { canDelete: false, isOwner: false, collaborators: { adoptions: 0, images: 0, edits: 0, flags: 0, forms: 0 } };

        const user = await getUser();
        const adopter = await db.select().from(adopters).where(eq(adopters.id, adopterId)).get();
        if (!adopter) return { canDelete: false, isOwner: false, collaborators: { adoptions: 0, images: 0, edits: 0, flags: 0, forms: 0 } };

        const isOwner = adopter.addedBy === user;
        if (!isOwner) return { canDelete: false, isOwner: false, collaborators: { adoptions: 0, images: 0, edits: 0, flags: 0, forms: 0 } };

        // Count contributions from OTHER users across all related tables
        const { adoptions: adoptionsTable, adopterImages, adopterFlags, formSubmissions } = await import('@/db/schema');

        const [otherAdoptions, otherImages, otherEdits, otherFlags, linkedForms] = await Promise.all([
            db.select({ count: sql<number>`COUNT(*)` }).from(adoptionsTable)
                .where(and(eq(adoptionsTable.adopterId, adopterId), sql`${adoptionsTable.addedBy} != ${user}`)).get(),
            db.select({ count: sql<number>`COUNT(*)` }).from(adopterImages)
                .where(and(eq(adopterImages.adopterId, adopterId), sql`${adopterImages.addedBy} != ${user}`)).get(),
            db.select({ count: sql<number>`COUNT(*)` }).from(adopterHistory)
                .where(and(eq(adopterHistory.adopterId, adopterId), sql`${adopterHistory.changedBy} != ${user}`)).get(),
            db.select({ count: sql<number>`COUNT(*)` }).from(adopterFlags)
                .where(eq(adopterFlags.adopterId, adopterId)).get(),
            db.select({ count: sql<number>`COUNT(*)` }).from(formSubmissions)
                .where(eq(formSubmissions.linkedAdopterId, adopterId)).get(),
        ]);

        const collaborators = {
            adoptions: otherAdoptions?.count || 0,
            images: otherImages?.count || 0,
            edits: otherEdits?.count || 0,
            flags: otherFlags?.count || 0,
            forms: linkedForms?.count || 0,
        };

        const totalOtherContributions = Object.values(collaborators).reduce((a, b) => a + b, 0);
        return { canDelete: totalOtherContributions === 0, isOwner: true, collaborators };
    } catch (error) {
        logger.error('Check adopter deletable failed', error, { adopterId });
        return { canDelete: false, isOwner: false, collaborators: { adoptions: 0, images: 0, edits: 0, flags: 0, forms: 0 } };
    }
}

export async function deleteOwnAdopter(adopterId: string) {
    try {
        const db = await getDb();
        if (!db) throw new Error('No database');

        const user = await getUser();

        // Inline ownership check — avoids a full checkAdopterDeletable call
        // to minimize the TOCTOU window. We re-verify ownership + collaboration
        // right before deleting. The window between these queries and the
        // actual delete is ~10-50ms on D1, which is an acceptable risk.
        const adopter = await db.select().from(adopters).where(eq(adopters.id, adopterId)).get();
        if (!adopter || adopter.addedBy !== user) throw new Error('Not the owner');

        // Re-check collaboration inline (not via checkAdopterDeletable to shrink TOCTOU window)
        const { adoptions: adoptionsTable, adopterImages, adopterFlags, formSubmissions } = await import('@/db/schema');
        const [otherAdoptions, otherImages, otherEdits, otherFlags, linkedForms] = await Promise.all([
            db.select({ count: sql<number>`COUNT(*)` }).from(adoptionsTable)
                .where(and(eq(adoptionsTable.adopterId, adopterId), sql`${adoptionsTable.addedBy} != ${user}`)).get(),
            db.select({ count: sql<number>`COUNT(*)` }).from(adopterImages)
                .where(and(eq(adopterImages.adopterId, adopterId), sql`${adopterImages.addedBy} != ${user}`)).get(),
            db.select({ count: sql<number>`COUNT(*)` }).from(adopterHistory)
                .where(and(eq(adopterHistory.adopterId, adopterId), sql`${adopterHistory.changedBy} != ${user}`)).get(),
            db.select({ count: sql<number>`COUNT(*)` }).from(adopterFlags)
                .where(eq(adopterFlags.adopterId, adopterId)).get(),
            db.select({ count: sql<number>`COUNT(*)` }).from(formSubmissions)
                .where(eq(formSubmissions.linkedAdopterId, adopterId)).get(),
        ]);
        const totalOther = (otherAdoptions?.count || 0) + (otherImages?.count || 0) + (otherEdits?.count || 0) + (otherFlags?.count || 0) + (linkedForms?.count || 0);
        if (totalOther > 0) throw new Error('Record has contributions from other users');

        // Cascade delete all related data
        const { duplicateTokens, duplicateCandidates } = await import('@/db/schema');

        await Promise.all([
            db.delete(adoptionsTable).where(eq(adoptionsTable.adopterId, adopterId)),
            db.delete(adopterImages).where(eq(adopterImages.adopterId, adopterId)),
            db.delete(adopterHistory).where(eq(adopterHistory.adopterId, adopterId)),
            db.delete(adopterFlags).where(eq(adopterFlags.adopterId, adopterId)),
            db.delete(adopterStats).where(eq(adopterStats.adopterId, adopterId)),
            db.delete(duplicateTokens).where(eq(duplicateTokens.adopterId, adopterId)),
            db.delete(duplicateCandidates).where(sql`${duplicateCandidates.adopter1Id} = ${adopterId} OR ${duplicateCandidates.adopter2Id} = ${adopterId}`),
            db.update(formSubmissions).set({ linkedAdopterId: null }).where(eq(formSubmissions.linkedAdopterId, adopterId)),
        ]);

        await db.delete(adopters).where(eq(adopters.id, adopterId));

        logger.info('Adopter deleted by owner', { adopterId, deletedBy: user });
        logAudit({ userEmail: user, action: 'adopter_deleted', target: adopterId });

        return { success: true };
    } catch (error) {
        const errorId = logger.error('Delete adopter failed', error, { adopterId });
        throw new Error(`Failed to delete adopter (Error ID: ${errorId})`);
    }
}

export async function requestAdopterDeletion(adopterId: string) {
    try {
        const db = await getDb();
        if (!db) throw new Error('No database');

        const user = await getUser();

        // F3: Verify ownership before allowing request
        const adopter = await db.select().from(adopters).where(eq(adopters.id, adopterId)).get();
        if (!adopter || adopter.addedBy !== user) throw new Error('Not the owner');

        const { dataRequests } = await import('@/db/schema');

        // F4: Check for existing pending deletion request to prevent duplicates
        const existing = await db.select({ id: dataRequests.id }).from(dataRequests)
            .where(and(
                eq(dataRequests.adopterId, adopterId),
                eq(dataRequests.requestType, 'deletion'),
                eq(dataRequests.status, 'pending'),
            )).get();
        if (existing) return { success: true, alreadyRequested: true };

        await db.insert(dataRequests).values({
            id: crypto.randomUUID(),
            adopterId,
            requesterName: user,
            requesterEmail: user,
            requestType: 'deletion',
            details: `Owner-initiated deletion request. Record has contributions from other users.`,
            status: 'pending',
            createdAt: new Date(),
        });

        logger.info('Adopter deletion requested', { adopterId, requestedBy: user });
        logAudit({ userEmail: user, action: 'adopter_deletion_requested', target: adopterId });

        // Notify admins (fire-and-forget)
        import('@/app/actions/notifications').then(async ({ notifyAdmins, resolveDisplayName }) => {
            const displayName = await resolveDisplayName(user);
            notifyAdmins({
                actorEmail: user,
                type: 'deletion_request',
                title: '🗑️ Solicitud de eliminación',
                body: `${displayName} solicitó eliminar un registro de adoptante.`,
                url: '/admin/data-requests',
                icon: '🗑️',
                metadata: { adopterId },
            }).catch(() => {});
        });

        return { success: true };
    } catch (error) {
        const errorId = logger.error('Request adopter deletion failed', error, { adopterId });
        throw new Error(`Failed to request deletion (Error ID: ${errorId})`);
    }
}

