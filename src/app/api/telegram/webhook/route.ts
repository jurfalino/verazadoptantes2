/**
 * Telegram inbound webhook — admin's reply path back to the visitor.
 *
 * Wired up once via:
 *   curl -F "url=https://buenadoptante.org/api/telegram/webhook" \
 *        -F "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
 *        https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook
 *
 * Telegram POSTs `update` payloads here. We only care about admin messages
 * that are Replies to one of the bot's earlier forwarded messages — those
 * carry `message.reply_to_message.text` whose first 8 hex chars are the
 * routing token written by `formatForwardedMessage` in src/lib/telegram.ts.
 *
 * Two side-effects:
 *   1. New message rows are inserted with direction='admin'; the visitor's
 *      next GET /api/chat poll picks them up.
 *   2. /block command on a forwarded message flips chat_conversations.blocked.
 *
 * Authenticator: the `X-Telegram-Bot-Api-Secret-Token` header. Without it,
 * the route 401s — there is no other identity check.
 */

export const runtime = 'edge';

import { NextRequest, NextResponse } from 'next/server';
import { eq, like } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { chatConversations, chatMessages } from '@/db/schema';
import { extractConversationTag, sendTelegramMessage, verifyWebhookSecret } from '@/lib/telegram';

interface TelegramMessage {
    message_id: number;
    from?: { id: number };
    chat: { id: number };
    text?: string;
    reply_to_message?: { text?: string; message_id?: number };
}

interface TelegramUpdate {
    update_id: number;
    message?: TelegramMessage;
    edited_message?: TelegramMessage;
}

export async function POST(request: NextRequest) {
    let updateId: number | undefined;
    try {
        if (!verifyWebhookSecret(request.headers)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 401 });
        }

        const update = (await request.json().catch(() => ({}))) as TelegramUpdate;
        updateId = update.update_id;
        // We don't process edits — admin should send a fresh reply if they made a mistake.
        const msg = update.message;
        if (!msg || typeof msg.text !== 'string' || msg.text.length === 0) {
            return NextResponse.json({ ok: true });
        }

        const db = await getDb();
        if (!db) {
            logger.error('telegram.webhook: db unavailable', undefined, { updateId });
            return NextResponse.json({ error: 'db unavailable' }, { status: 500 });
        }

        // /block command: admin replies "/block" on a forwarded message to
        // mute that conversation. Subsequent visitor sends are silently dropped.
        const command = msg.text.trim().toLowerCase();
        const isBlockCommand = command === '/block' || command === '/unblock';

        const tag = extractConversationTag(msg.reply_to_message?.text);
        if (!tag) {
            // Admin sent a plain message (no Reply gesture) — guide them.
            await sendTelegramMessage(String(msg.chat.id), 'Use Telegram\'s Reply gesture on the visitor\'s message to direct your reply. The bot routes by the [#xxxxxxxx] tag at the top of each forwarded message.');
            return NextResponse.json({ ok: true });
        }

        // Match conversation by 8-char prefix. UUID v4 collisions at 8 hex
        // chars are 1 in 4 billion — for a single-tenant chat with at most
        // hundreds of conversations, this is safe.
        const conversation = await db.select().from(chatConversations)
            .where(like(chatConversations.id, `${tag}%`))
            .get();

        if (!conversation) {
            await sendTelegramMessage(String(msg.chat.id), `No matching conversation for [#${tag}]. It may have been deleted or the tag was edited.`);
            return NextResponse.json({ ok: true });
        }

        if (isBlockCommand) {
            const newBlocked = command === '/block' ? 1 : 0;
            await db.update(chatConversations)
                .set({ blocked: newBlocked })
                .where(eq(chatConversations.id, conversation.id));
            await sendTelegramMessage(String(msg.chat.id), `Conversation [#${tag}] ${newBlocked ? 'blocked. Future visitor messages will be dropped silently.' : 'unblocked.'}`);
            logger.info('telegram.webhook: conversation block toggled', { conversationId: conversation.id, blocked: newBlocked });
            return NextResponse.json({ ok: true });
        }

        const messageId = crypto.randomUUID();
        const now = new Date();
        await db.insert(chatMessages).values({
            id: messageId,
            conversationId: conversation.id,
            direction: 'admin',
            body: msg.text,
        });
        await db.update(chatConversations)
            .set({ lastMessageAt: now })
            .where(eq(chatConversations.id, conversation.id));

        return NextResponse.json({ ok: true });
    } catch (e) {
        const errorId = logger.error('telegram.webhook failed', e, { updateId });
        return NextResponse.json({ error: 'Webhook error', errorId }, { status: 500 });
    }
}
