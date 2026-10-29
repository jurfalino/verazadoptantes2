/**
 * The part of a pair merge that comes AFTER deciding who may merge it and
 * which side stays — shared by «Pendientes de revisar» (mergePendingDedupPair,
 * src/app/actions/duplicates.ts) and «Ya está en otro perfil» → «Continuar con
 * este perfil» (continueWithMatchedProfile, src/app/actions/dupHintActions.ts),
 * so both merge, grant and tell people the same way:
 *
 * 1. the shared merge (mergeAdopters: everything of `secondaryId` moves onto
 *    `primaryId`, the pair's flags are annotated, requests naming the absorbed
 *    side close);
 * 2. D40: the absorbed profile's owner team keeps seeing what it had —
 *    full contact after an admin's merge, otherwise only the contact values
 *    the absorbed profile brought (grantAccessAfterFold);
 * 3. the notices: an admin's merge (`viaAdmin`) tells whoever registered
 *    either profile (notifyMergeOwners); a rescuer's tells the kept profile's
 *    owner when it is someone else's (`notifyOwner`, adopter_merged_by_rescuer).
 *    The merge stands even if a notice fails (logged).
 *
 * Auth is the caller's: it decided `viaAdmin` / `notifyOwner` from the
 * session. `label` + `ctx` name the caller in every log line (the
 * «Pendientes» lines keep their wording). A plain server module, NOT 'use server'.
 */
import { mergeAdopters, notifyMergeOwners, type MergeAdoptersResult } from '@/lib/adopterMerge';
import { grantAccessAfterFold } from '@/lib/mergeAccess';
import { mergeSideParams } from '@/lib/mergeNotificationSides';
import { notificationContent } from '@/domain/notificationTemplates';
import { realOwner } from '@/domain/dedupPair';
import { HOUSEHOLD_NOT_CONVERTED } from '@/domain/households';
import { normEmail } from '@/lib/orgMembership';
import { logger } from '@/lib/logger';
import type { getDb } from '@/lib/db';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type PairMergeOutcome =
    | { ok: true; result: MergeAdoptersResult }
    /** Some old household data of these two couldn't be converted yet: retryable, nothing moved. */
    | { ok: false; error: typeof HOUSEHOLD_NOT_CONVERTED }
    | { ok: false; error: 'merge_failed'; errorId: string };

export async function mergeChosenPair(db: Db, input: {
    primaryId: string;
    secondaryId: string;
    actor: string;
    /** The absorbed owner team gets full contact on the survivor (a consented fold), else only what their profile brought. */
    fullAccess: boolean;
    /** An admin merging what a rescuer couldn't: every owner hears it (notifyMergeOwners). */
    viaAdmin: boolean;
    /** A rescuer's merge into someone else's profile: that owner hears it. */
    notifyOwner: string | null;
    /** Who registered the absorbed profile (its team keeps access, D40). */
    absorbedAddedBy: string | null;
    label: string;
    ctx: Record<string, unknown>;
}): Promise<PairMergeOutcome> {
    const { primaryId, secondaryId, actor, viaAdmin, notifyOwner, label, ctx } = input;
    const result = await mergeAdopters(primaryId, secondaryId, actor);
    if (!result.success && result.error === HOUSEHOLD_NOT_CONVERTED) return { ok: false, error: HOUSEHOLD_NOT_CONVERTED };
    if (!result.success) {
        const errorId = logger.error(`${label}: merge failed`, new Error(result.error ?? 'merge failed'), {
            ...ctx, primaryId, secondaryId,
        });
        return { ok: false, error: 'merge_failed', errorId };
    }
    logger.info(`${label}: merged`, { ...ctx, primaryId, secondaryId, viaAdmin, notifyOwner: !!notifyOwner });
    // D40: the absorbed profile's owner team keeps seeing what it had. Best-effort.
    // `fullAccess` (a consented fold) → full contact; otherwise a rescuer
    // merging without asking either kept a profile of their own team (nothing
    // to grant) or kept the OTHER rescuer's, who never agreed: then only the
    // contact values the absorbed profile brought (final review C1). The
    // caller says which: «Continuar» passes `viaAdmin` (an admin folding their
    // own team's profile into another rescuer's is a rescuer merge, review F4);
    // «Pendientes» still passes `isAdmin`, its tested behaviour (see the report).
    await grantAccessAfterFold(db, {
        survivorId: primaryId, absorbedOwnerEmail: realOwner(input.absorbedAddedBy), actor, mergeAuditId: result.auditId ?? null,
        access: input.fullAccess ? { scope: 'all_contact' } : { scope: 'absorbed_entries', absorbedId: secondaryId },
    });
    if (viaAdmin) {
        // Whoever registered either profile hears that an admin joined them.
        await notifyMergeOwners({ primaryId, secondaryId, ...result }, actor);
    } else if (notifyOwner) {
        // Their profile absorbed the caller's record: tell them. The merge
        // stands even if the notice fails.
        try {
            const { createNotification, resolveDisplayName } = await import('@/app/actions/notifications');
            const [requester, sides] = await Promise.all([
                resolveDisplayName(actor),
                mergeSideParams(db, { survivorId: primaryId, absorbedId: secondaryId }, { survivorName: result.primaryName, absorbedName: result.secondaryName }),
            ]);
            await createNotification({
                type: 'adopter_merged',
                // Normalized: notifications are keyed (bell, email) by the
                // lowercased email, and `added_by` keeps whatever case it had.
                userId: normEmail(notifyOwner),
                ...notificationContent({ key: 'adopter_merged_by_rescuer', params: { actorName: requester, ...sides, ...(result.auditId ? { disputable: '1' } : {}) } }),
                // «¿No es la misma persona?» opens from here (D50).
                url: result.auditId ? `/adopter/${primaryId}?dispute=${encodeURIComponent(result.auditId)}` : `/adopter/${primaryId}`,
                icon: '🔗',
                metadata: { primaryId, secondaryId, auditId: result.auditId ?? null },
            });
        } catch (e) {
            logger.warn(`${label}: owner notice not sent`, {
                ...ctx, primaryId, secondaryId, error: e instanceof Error ? e.message : String(e),
            });
        }
    }
    return { ok: true, result };
}
