'use server';

import { adopterFlags, adopterHistory } from '@/db/schema';
import { eq, sql, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { getDb, getUser, checkIsAdminAsync } from './_db';
import { flagAdopterSchema, dismissFlagSchema, removeVerificationSchema } from './validation';

export async function flagAdopter(adopterId: string, reason: string, details?: string, targetAdopterId?: string) {
    const parsed = flagAdopterSchema.safeParse({ adopterId, reason, details, targetAdopterId });
    if (!parsed.success) {
        throw new Error(`Invalid flag data: ${parsed.error.issues.map(i => i.message).join(', ')}`);
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
        console.error("Dismiss flag error:", error);
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
