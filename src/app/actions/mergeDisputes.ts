'use server';

/**
 * Disputes about a merge that already happened (D50), from the browser. Thin:
 * the actor is the session, never an argument; who may do what is decided in
 * src/lib/mergeDisputes.ts (→ decideMergeDisputeRaise /
 * decideMergeDisputeResolution in src/domain/dedupPair.ts). Safe with ids a
 * stranger chooses: raising needs the session to be on the owner team of one
 * of that merge's profiles (anyone else reads `not_found`, like a guessed id),
 * and resolving needs an admin.
 */

import { getDb, getUser } from './_db';
import { logger, generateErrorId } from '@/lib/logger';
import { answerMergeDispute, fileMergeDispute, mergeDisputeOption, type MergeDisputeOption } from '@/lib/mergeDisputes';

type ActionResult = { success: boolean; error?: string; errorId?: string };

/** Longest id accepted from the browser. */
const ID_MAX = 200;
const validId = (id: unknown): id is string => typeof id === 'string' && !!id.trim() && id.length <= ID_MAX;

async function run(op: string, ctx: Record<string, unknown>, body: (actor: string, db: NonNullable<Awaited<ReturnType<typeof getDb>>>) => Promise<ActionResult>): Promise<ActionResult> {
    let actor: string | null = null;
    try {
        // getUser logs its own auth failure; anonymous is refused below.
        actor = await getUser().catch(() => null);
        if (!actor) {
            const errorId = generateErrorId();
            logger.warn(`${op}: refused`, { ...ctx, actor, reason: 'unauthenticated', errorId });
            return { success: false, error: 'unauthenticated', errorId };
        }
        const db = await getDb();
        if (!db) {
            const errorId = logger.error(`${op}: database not available`, new Error('Database not available'), { ...ctx, actor });
            return { success: false, error: 'failed', errorId };
        }
        return await body(actor, db);
    } catch (e) {
        const errorId = logger.error(`${op} failed`, e, { ...ctx, actor });
        return { success: false, error: 'failed', errorId };
    }
}

function refused(op: string, ctx: Record<string, unknown>, reason: string): ActionResult {
    const errorId = generateErrorId();
    logger.warn(`${op}: refused`, { ...ctx, reason, errorId });
    return { success: false, error: reason, errorId };
}

/**
 * «¿No es la misma persona? Avisar a un administrador» (D50): the owner team of
 * either profile of the merge `auditId` (the `adopter_merged` notice's link)
 * asks the admins to review it. Idempotent while one is open.
 */
export async function raiseMergeDispute(auditId: string): Promise<ActionResult> {
    return run('raiseMergeDispute', { auditId }, async (actor, db) => {
        const ctx = { auditId, actor };
        if (!validId(auditId)) return refused('raiseMergeDispute', ctx, 'not_found');
        const result = await fileMergeDispute(db, auditId, actor);
        if (!result.ok) return refused('raiseMergeDispute', ctx, result.reason);
        return { success: true };
    });
}

/** Whether the session may raise a dispute on the merge `auditId`, and its state — for the profile prompt. Never throws. */
export async function getMergeDisputeOption(auditId: string): Promise<MergeDisputeOption> {
    const none: MergeDisputeOption = { canRaise: false, status: 'none' };
    let actor: string | null = null;
    try {
        actor = await getUser().catch(() => null);
        if (!actor || !validId(auditId)) return none;
        const db = await getDb();
        if (!db) {
            logger.warn('getMergeDisputeOption: database not available', { auditId, actor });
            return none;
        }
        return await mergeDisputeOption(db, auditId, actor);
    } catch (e) {
        logger.warn('getMergeDisputeOption failed, prompt hidden', { auditId, actor, error: e instanceof Error ? e.message : String(e) });
        return none;
    }
}

/** Admin: «Deshacer combinación» (`undo`) or «Mantener» (`keep`) on an open dispute (D50). */
export async function resolveMergeDispute(disputeId: string, decision: 'undo' | 'keep'): Promise<ActionResult> {
    return run('resolveMergeDispute', { disputeId, decision }, async (actor, db) => {
        const ctx = { disputeId, decision, actor };
        if (!validId(disputeId)) return refused('resolveMergeDispute', ctx, 'not_found');
        if (decision !== 'undo' && decision !== 'keep') return refused('resolveMergeDispute', ctx, 'invalid');
        const result = await answerMergeDispute(db, disputeId, actor, decision);
        if (!result.ok) {
            // The lib logged the failed undo with its own errorId.
            if (result.reason === 'undo_failed') return { success: false, error: result.error, errorId: result.errorId };
            return refused('resolveMergeDispute', ctx, result.reason);
        }
        return { success: true };
    });
}
