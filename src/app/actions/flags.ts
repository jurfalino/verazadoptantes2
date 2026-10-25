'use server';

import { adopterFlags, adopterHistory, adopters } from '@/db/schema';
import { eq, sql, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { generateErrorId, logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { getDb, getUser, checkIsAdminAsync } from './_db';
import { flagAdopterSchema, dismissFlagSchema, removeVerificationSchema } from './validation';
import { runAfterResponse } from '@/lib/background';
import { FLAG_REASONS } from '@/domain/constants';

export async function flagAdopter(adopterId: string, reason: string, details?: string, targetAdopterId?: string) {
    const parsed = flagAdopterSchema.safeParse({ adopterId, reason, details, targetAdopterId });
    if (!parsed.success) {
        throw new Error(`Invalid flag data: ${parsed.error.issues.map(i => i.message).join(', ')}`);
    }

    // A duplicate flag with a target puts the pair on the flagger's
    // «Pendientes de revisar», where they can merge it: only someone who may
    // act for the flagged profile — its owner, their team, or an admin — may
    // file one (final review C1). Checked before the try so the refusal is
    // logged once, at warn.
    if (reason === FLAG_REASONS.DUPLICATE && targetAdopterId) {
        await refuseDuplicateFlagUnlessOwner(adopterId, targetAdopterId);
    }

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

        // Log to audit history. Drizzle silently drops unknown column keys,
        // so the prior `changeType / fieldName / newValue` shape produced rows
        // with empty `changes` and the renderer rendered them as the
        // misleading "Metadata update" placeholder. The canonical shape across
        // every other writer is `changes: JSON.stringify({<event_key>: {...}})`.
        await db.insert(adopterHistory).values({
            id: crypto.randomUUID(),
            adopterId,
            changedBy: flaggedBy,
            changes: JSON.stringify({ flag_added: { reason, details: details || null } }),
            changedAt: new Date()
        });

        logAudit({ userEmail: flaggedBy, action: 'flag_created', target: adopterId, details: { reason, details } });

        // Notify admins (after the response, kept alive — see src/lib/background.ts)
        await runAfterResponse('flagAdopter.notifyAdmins', async () => {
            const [{ notifyAdmins, resolveDisplayName }, { notificationContent }] = await Promise.all([
                import('@/app/actions/notifications'), import('@/domain/notificationTemplates'),
            ]);
            const displayName = await resolveDisplayName(flaggedBy);
            await notifyAdmins({
                actorEmail: flaggedBy,
                type: 'adopter_flagged',
                ...notificationContent({ key: 'adopter_flagged', params: { reporterName: displayName, reason } }),
                url: `/adopter/${adopterId}`,
                icon: '🚩',
                metadata: { adopterId, reason, details },
            });
        }, { adopterId, flaggedBy });

        return { success: true, id };
    } catch (error) {
        const errorId = logger.error('Flag adopter failed', error, { adopterId, reason });
        throw new Error(`Failed to flag adopter (Error ID: ${errorId})`);
    }
}

/** Throws (logged at warn, with an errorId) unless the session user may flag `adopterId` as a duplicate. */
async function refuseDuplicateFlagUnlessOwner(adopterId: string, targetAdopterId: string): Promise<void> {
    let flaggedBy: string | null = null;
    let allowed = false;
    let reason = 'not_owner';
    try {
        flaggedBy = await getUser();
        const db = await getDb();
        if (!db) throw new Error('No database');
        const flagged = await db.select({ addedBy: adopters.addedBy }).from(adopters).where(eq(adopters.id, adopterId)).get();
        if (!flagged) reason = 'not_found';
        else {
            const { isOwnerOrOrgMate } = await import('@/lib/orgMembership');
            allowed = await checkIsAdminAsync(flaggedBy) || await isOwnerOrOrgMate(flaggedBy, flagged.addedBy);
        }
    } catch (e) {
        reason = 'check_failed';
        logger.warn('flagAdopter: duplicate flag check failed', { adopterId, targetAdopterId, flaggedBy, error: e instanceof Error ? e.message : String(e) });
    }
    if (allowed) return;
    const errorId = generateErrorId();
    logger.warn('flagAdopter: duplicate flag refused', { adopterId, targetAdopterId, flaggedBy, reason, errorId });
    throw new Error(`Not allowed to flag this profile as a duplicate (Error ID: ${errorId})`);
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
        logger.error('Get flags failed', error, { adopterId });
        return [];
    }
}

export async function dismissFlag(flagId: string) {
    const parsed = dismissFlagSchema.safeParse({ flagId });
    if (!parsed.success) {
        throw new Error(`Invalid flag ID: ${parsed.error.issues.map(i => i.message).join(', ')}`);
    }

    try {
        const session = await auth();
        if (!session?.user?.email || !await checkIsAdminAsync(session.user.email)) {
            throw new Error("Unauthorized");
        }

        const db = await getDb();
        if (!db) throw new Error("No database");

        await db.delete(adopterFlags).where(eq(adopterFlags.id, flagId));
        revalidatePath('/admin/flags');
        return { success: true };
    } catch (error) {
        const errorId = logger.error('Dismiss flag failed', error, { flagId });
        throw new Error(`Failed to dismiss flag (Error ID: ${errorId})`);
    }
}

export async function removeVerification(adopterId: string, type: 'verified_identity' | 'verified_address') {
    const parsed = removeVerificationSchema.safeParse({ adopterId, type });
    if (!parsed.success) {
        throw new Error(`Invalid verification data: ${parsed.error.issues.map(i => i.message).join(', ')}`);
    }

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
        const userIsAdmin = session?.user?.email && await checkIsAdminAsync(session.user.email);
        if (flag.flaggedBy !== currentUser && !userIsAdmin) {
            throw new Error("Unauthorized - only the person who added the verification or an admin can remove it");
        }

        await db.delete(adopterFlags).where(eq(adopterFlags.id, flag.id));

        // Same canonical-shape fix as flagAdopter above — the old
        // changeType/fieldName/oldValue keys aren't columns and Drizzle
        // dropped them, so verification-removal events rendered as the
        // "Metadata update" placeholder forever.
        await db.insert(adopterHistory).values({
            id: crypto.randomUUID(),
            adopterId,
            changedBy: currentUser,
            changes: JSON.stringify({ flag_removed: { reason: type, originalFlaggedBy: flag.flaggedBy || null } }),
            changedAt: new Date()
        });

        return { success: true };
    } catch (error) {
        const errorId = logger.error('Remove verification failed', error, { adopterId, type });
        throw new Error(`Failed to remove verification (Error ID: ${errorId})`);
    }
}
