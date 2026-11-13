'use server';

/**
 * «Escribirle» (Pendientes D, D28): a short message from one side of a merge
 * request to the other. It is kept on the pair (`pair_messages`, shown in the
 * open pair in «Pendientes de revisar», 2026-11-11), then delivered as a bell
 * notification whose email twin carries reply_to = the sender. The recipient's
 * address never leaves the server and the sender's goes only to people they
 * chose to write to. Thin: the actor is the session, never an argument.
 *
 * The message row decides the outcome: not written = the send fails (logged,
 * errorId); written but a notice failed = a success, logged. Bodies are never
 * logged.
 */

import { eq } from 'drizzle-orm';
import { getDb, getUser } from './_db';
import { adopters, mergeRequests, pairMessages } from '@/db/schema';
import { logger, generateErrorId } from '@/lib/logger';
import { getOrgMemberEmailsFor, isOwnerOrOrgMate, normEmail } from '@/lib/orgMembership';
import { createNotification, resolveDisplayName } from './notifications';
import { notificationContent } from '@/domain/notificationTemplates';
import { pairKey } from '@/domain/dedupPair';

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
        const content = notificationContent({
            key: 'pair_message',
            params: { fromName, message, ...(profile?.name ? { profileName: profile.name } : {}) },
        });

        // 1. The message, on the pair. Without it there is no message: the send fails.
        const messageId = crypto.randomUUID();
        try {
            await db.insert(pairMessages).values({ id: messageId, requestId, senderEmail: me, senderName: fromName, body: message, createdAt: new Date() });
        } catch (e) {
            const errorId = logger.error('sendPairMessage: message not saved', e, { requestId, actor });
            return { success: false, error: 'failed', errorId };
        }

        // 2. The notices. replyTo stays in metadata: the email twin's reply_to (the template rides
        //    beside it); messageId marks a notice whose text is already on the pair.
        const metadata = { requestId, messageId, replyTo: actor, fromName };
        // The notice opens the pair itself (opened, scrolled to and outlined — PendingDedup's ?pair=), as a
        // «posible duplicado» notice does, wherever it sits in the reader's list (CX review I3).
        const url = `/my-adopters?pair=${encodeURIComponent(pairKey(req.primaryId, req.secondaryId))}#pendientes`;
        try {
            const ids = await Promise.all(recipients.map(userId =>
                createNotification({ userId, type: 'pair_message', ...content, url, icon: '✉️', metadata })));
            const notSent = ids.filter(id => !id).length;
            if (notSent) logger.warn('sendPairMessage: message saved, some notices not sent', { requestId, actor, messageId, notSent, recipientCount: recipients.length });
        } catch (e) {
            logger.warn('sendPairMessage: message saved, notices failed', { requestId, actor, messageId, error: e instanceof Error ? e.message : String(e) });
        }
        logger.info('sendPairMessage: sent', { requestId, actor, messageId, recipientCount: recipients.length });
        return { success: true };
    } catch (e) {
        const errorId = logger.error('sendPairMessage failed', e, { requestId, actor });
        return { success: false, error: 'failed', errorId };
    }
}
