'use server';

/**
 * Answering merge requests from the browser. Thin: the actor is the session,
 * never an argument; who may do what is decided in answerMergeRequest
 * (src/lib/mergeRequests.ts → decideMergeRequestAnswer). Safe with a request id
 * a stranger chooses: they are neither the requester, on the owner's team, nor
 * an admin, so every decision is refused (and logged).
 */

import { getDb, getUser } from './_db';
import { logger, generateErrorId } from '@/lib/logger';
import { answerMergeRequest, type MergeRequestDecision } from '@/lib/mergeRequests';

type ActionResult = { success: boolean; error?: string; errorId?: string };

async function answer(op: string, requestId: string, decision: unknown, allowed: readonly MergeRequestDecision[]): Promise<ActionResult> {
    let actor: string | null = null;
    try {
        // getUser logs its own auth failure; anonymous is refused below.
        actor = await getUser().catch(() => null);
        const refuse = (reason: string): ActionResult => {
            const errorId = generateErrorId();
            logger.warn(`${op}: refused`, { requestId, actor, reason, errorId });
            return { success: false, error: reason, errorId };
        };
        if (!actor) return refuse('unauthenticated');
        if (typeof requestId !== 'string' || !requestId.trim()) return refuse('not_found');
        if (!allowed.includes(decision as MergeRequestDecision)) return refuse('invalid');

        const db = await getDb();
        if (!db) {
            const errorId = logger.error(`${op}: database not available`, new Error('Database not available'), { requestId, actor });
            return { success: false, error: 'failed', errorId };
        }
        const result = await answerMergeRequest(db, requestId, actor, decision as MergeRequestDecision);
        if (!result.ok) return refuse(result.reason);
        return { success: true };
    } catch (e) {
        const errorId = logger.error(`${op} failed`, e, { requestId, actor });
        return { success: false, error: 'failed', errorId };
    }
}

/**
 * Owner / teammate / admin: accept, decline, or flip a merge request — «Conservar
 * el mío» (D26): the asked owner's profile stays and the requester's folds in.
 */
export async function resolveMergeRequest(requestId: string, decision: 'accept' | 'decline' | 'flip'): Promise<ActionResult> {
    return answer('resolveMergeRequest', requestId, decision, ['accept', 'decline', 'flip']);
}

/** Requester: withdraw their own pending request. */
export async function cancelMergeRequest(requestId: string): Promise<ActionResult> {
    return answer('cancelMergeRequest', requestId, 'cancel', ['cancel']);
}
