'use server';

import { adopterFlags, adopterHistory, adopters } from '@/db/schema';
import { eq, sql, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { logger, generateErrorId } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { getDb, getUser, checkIsAdminAsync } from './_db';
import { flagAdopterSchema, dismissFlagSchema, removeVerificationSchema } from './validation';
import { runAfterResponse } from '@/lib/background';
import { historyKindFor } from '@/lib/profilePrivilege';
import { FLAG_REASONS } from '@/domain/constants';

export type FlagAdopterResult =
    /** `already`: an open duplicate flag already covers this pair (either direction) — its id, nothing new written or sent. */
    | { success: true; id: string; already?: true }
    /**
     * A duplicate flag refused: 'invalid_target' (the same profile, or one that
     * doesn't exist or was merged away); 'said_no' (someone already said they are
     * two people — declined for the flagger's team, or an admin ruled it — as the
     * «Ya está en otro perfil» window says); 'settled_separate' (already recorded as
     * two people: a shared home, «Mantener separados», «Viven juntos» — for admins too).
     */
    | { success: false; error: 'invalid_target' | 'said_no' | 'settled_separate'; errorId: string };

export async function flagAdopter(adopterId: string, reason: string, details?: string, targetAdopterId?: string): Promise<FlagAdopterResult> {
    const parsed = flagAdopterSchema.safeParse({ adopterId, reason, details, targetAdopterId });
    if (!parsed.success) {
        throw new Error(`Invalid flag data: ${parsed.error.issues.map(i => i.message).join(', ')}`);
    }

    try {
        const db = await getDb();
        if (!db) throw new Error("No database");
        const flaggedBy = await getUser();

        // A duplicate flag names a pair — the profile menu «Reportar → Duplicado» and the
        // «Ya está en otro perfil» window alike: once per pair, two real live profiles,
        // and never on a pair someone already said are two people.
        if (reason === FLAG_REASONS.DUPLICATE && targetAdopterId) {
            const refuse = (error: 'invalid_target' | 'said_no' | 'settled_separate') => {
                const errorId = generateErrorId();
                logger.warn('flagAdopter: duplicate flag refused', { adopterId, targetAdopterId, actor: flaggedBy, reason: error, errorId });
                return { success: false as const, error, errorId };
            };
            if (targetAdopterId === adopterId) return refuse('invalid_target');
            const live = (id: string) => db.select({ deletedAt: adopters.deletedAt }).from(adopters).where(eq(adopters.id, id)).get() as Promise<{ deletedAt: Date | null } | undefined>;
            const [a, b] = await Promise.all([live(adopterId), live(targetAdopterId)]);
            if (!a || !b || a.deletedAt || b.deletedAt) return refuse('invalid_target');
            const { pairUnderReview, pairSettledSeparate, loadPairVerdict, teamOf } = await import('@/lib/pairVerdict');
            if (await pairSettledSeparate(db, adopterId, targetAdopterId)) return refuse('settled_separate');
            const review = await pairUnderReview(db, adopterId, targetAdopterId);
            if (review.flagId) {
                logger.info('flagAdopter: the pair already has an open duplicate flag, no second one', { adopterId, targetAdopterId, actor: flaggedBy, flagId: review.flagId });
                return { success: true, id: review.flagId, already: true };
            }
            const { isAdminAsync } = await import('@/config/admins');
            if (!(await isAdminAsync(flaggedBy))) {
                const verdict = await loadPairVerdict(db, adopterId, targetAdopterId, await teamOf(flaggedBy));
                if (verdict.declinedForTeam || verdict.adminRuledSeparate) return refuse('said_no');
            }
        }

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
        // Flagging is open to anyone signed in: a stranger's flag is a
        // contribution, never an 'edit' (src/lib/profilePrivilege.ts).
        await db.insert(adopterHistory).values({
            id: crypto.randomUUID(),
            adopterId,
            changedBy: flaggedBy,
            kind: await historyKindFor(db, adopterId, flaggedBy),
            changes: JSON.stringify({ flag_added: { reason, details: details || null } }),
            changedAt: new Date()
        });

        logAudit({ userEmail: flaggedBy, action: 'flag_created', target: adopterId, details: { reason, details } });

        // Notify admins (after the response, kept alive — see src/lib/background.ts).
        // A duplicate flag with a target also tells whoever added each profile
        // first (duplicate_flagged); an owner who is an admin gets only that one.
        await runAfterResponse('flagAdopter.notifyAdmins', async () => {
            let ownersTold: string[] = [];
            if (reason === FLAG_REASONS.DUPLICATE && targetAdopterId) {
                try {
                    const { notifyDuplicateFlagOwners } = await import('@/lib/duplicateFlagNotices');
                    ownersTold = await notifyDuplicateFlagOwners({ adopterId, targetAdopterId, flaggedBy });
                } catch (e) {
                    logger.warn('flagAdopter: duplicate owner notices not sent', {
                        adopterId, targetAdopterId, actor: flaggedBy, error: e instanceof Error ? e.message : String(e),
                    });
                }
            }
            const [{ notifyAdmins, resolveDisplayName }, { notificationContent }] = await Promise.all([
                import('@/app/actions/notifications'), import('@/domain/notificationTemplates'),
            ]);
            const displayName = await resolveDisplayName(flaggedBy);
            await notifyAdmins({
                skip: ownersTold,
                actorEmail: flaggedBy,
                type: 'adopter_flagged',
                ...notificationContent({ key: 'adopter_flagged', params: { reporterName: displayName, reason } }),
                url: `/adopter/${adopterId}`,
                icon: '🚩',
                metadata: { adopterId, reason, details },
            });
        }, { adopterId, targetAdopterId: targetAdopterId ?? null, flaggedBy });

        return { success: true, id };
    } catch (error) {
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
            // The flagger removing their own verification is no editor of the profile.
            kind: await historyKindFor(db, adopterId, currentUser),
            changes: JSON.stringify({ flag_removed: { reason: type, originalFlaggedBy: flag.flaggedBy || null } }),
            changedAt: new Date()
        });

        return { success: true };
    } catch (error) {
        const errorId = logger.error('Remove verification failed', error, { adopterId, type });
        throw new Error(`Failed to remove verification (Error ID: ${errorId})`);
    }
}
