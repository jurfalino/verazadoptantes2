'use server';

/**
 * «Escribirle» (Pendientes D, D28): a short message from one side of a merge
 * request to the other, as a bell notification whose email twin carries
 * reply_to = the sender. The recipient's address never leaves the server and
 * the sender's goes only to people they chose to write to. Thin: the actor is
 * the session, never an argument.
 */

import { eq } from 'drizzle-orm';
import { getDb, getUser } from './_db';
import { adopters, mergeRequests } from '@/db/schema';
import { logger, generateErrorId } from '@/lib/logger';
import { getOrgMemberEmailsFor, isOwnerOrOrgMate, normEmail } from '@/lib/orgMembership';
import { createNotification, resolveDisplayName } from './notifications';

type ActionResult = { success: boolean; error?: string; errorId?: string };

const MAX_LENGTH = 1000;
const OPEN_STATUSES: readonly string[] = ['pending', 'declined'];

export async function sendPairMessage(requestId: string, text: string): Promise<ActionResult> {
    let actor: string | null = null;
    try {
        actor = await getUser().catch(() => null);
        const refuse = (reason: string): ActionResult => {
            const errorId = generateErrorId();
            logger.warn('sendPairMessage: refused', { requestId, actor, reason, errorId });
            return { success: false, error: reason, errorId };
        };
        if (!actor) return refuse('unauthenticated');
        const message = typeof text === 'string' ? text.trim() : '';
        if (message.length < 1 || message.length > MAX_LENGTH) return refuse('invalid');
        if (typeof requestId !== 'string' || !requestId.trim()) return refuse('not_found');

        const db = await getDb();
        if (!db) {
            const errorId = logger.error('sendPairMessage: database not available', new Error('Database not available'), { requestId, actor });
            return { success: false, error: 'failed', errorId };
        }
        const req = await db.select().from(mergeRequests).where(eq(mergeRequests.id, requestId)).get() as typeof mergeRequests.$inferSelect | undefined;
        if (!req) return refuse('not_found');

        const me = normEmail(actor);
        const isRequester = normEmail(req.requesterEmail) === me;
        // Messages are rescuer-to-rescuer: an admin-routed request has no owner side.
        if (!req.ownerEmail) return refuse('no_recipient');
        if (!isRequester && !(await isOwnerOrOrgMate(actor, req.ownerEmail))) return refuse('not_allowed');
        if (!OPEN_STATUSES.includes(req.status)) return refuse('not_open');

        const other = isRequester ? await getOrgMemberEmailsFor(req.ownerEmail) : [req.requesterEmail];
        const seen = new Set<string>();
        const recipients = other.filter(email => {
            const key = normEmail(email);
            if (!key || key === me || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        if (recipients.length === 0) return refuse('no_recipient');

        const [fromName, profile] = await Promise.all([
            resolveDisplayName(actor),
            db.select({ name: adopters.name }).from(adopters).where(eq(adopters.id, req.primaryId)).get() as Promise<{ name: string } | undefined>,
        ]);
        const title = `${fromName} te escribió sobre «${profile?.name ?? ''}»`;
        const metadata = { requestId, replyTo: actor, fromName };
        await Promise.all(recipients.map(userId =>
            createNotification({ userId, type: 'pair_message', title, body: message, url: '/my-adopters#pendientes', icon: '✉️', metadata })));
        logger.info('sendPairMessage: sent', { requestId, actor, recipientCount: recipients.length });
        return { success: true };
    } catch (e) {
        const errorId = logger.error('sendPairMessage failed', e, { requestId, actor });
        return { success: false, error: 'failed', errorId };
    }
}
