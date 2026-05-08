/**
 * Support chat — visitor-facing endpoint.
 *
 * POST /api/chat — visitor sends a message:
 *   1. validate input + conversationId
 *   2. enforce per-conversation rate limit (≤1 msg / 5s, ≤30 / rolling hour)
 *   3. drop silently if conversation is admin-blocked
 *   4. write 'user' row to chat_messages
 *   5. forward to admin's Telegram chat with the routing prefix
 *   6. persist returned message_id (admin Reply gesture targets it)
 *
 * GET /api/chat?conversationId=<uuid>&since=<unix-ms> — visitor poll:
 *   returns messages newer than `since` for that conversation.
 *
 * Privacy: this endpoint and the Telegram outbound fetch are the only paths
 * between visitor and admin. The browser never touches Telegram directly.
 */

export const runtime = 'edge';

import { NextRequest, NextResponse } from 'next/server';
import { eq, and, gt, asc } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { chatConversations, chatMessages, appConfig } from '@/db/schema';
import { isTelegramConfigured, sendTelegramMessage, formatForwardedMessage } from '@/lib/telegram';
import { getFeatureFlag } from '@/config/features';

const RATE_LIMIT_MIN_GAP_MS = 5_000;
const RATE_LIMIT_HOUR_MAX = 30;
const RATE_LIMIT_HOUR_WINDOW_MS = 60 * 60 * 1000;
const MAX_BODY_LEN = 2000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getAdminChatId(db: NonNullable<Awaited<ReturnType<typeof getDb>>>): Promise<string> {
    const row = await db.select().from(appConfig).where(eq(appConfig.key, 'TELEGRAM_ADMIN_CHAT_ID')).get();
    return row?.value || '';
}

export async function POST(request: NextRequest) {
    let conversationId: string | undefined;
    try {
        if (!(await getFeatureFlag('ENABLE_CHAT_WIDGET'))) {
            return NextResponse.json({ error: 'Chat is not enabled' }, { status: 403 });
        }

        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        conversationId = typeof body.conversationId === 'string' ? body.conversationId : undefined;
        const messageBody = typeof body.body === 'string' ? body.body.trim() : '';
        const userLabel = typeof body.userLabel === 'string' ? body.userLabel.trim().slice(0, 80) : '';
        const honeypot = typeof body.companyName === 'string' ? body.companyName : '';

        // Honeypot — humans never fill this hidden field. Pretend success.
        if (honeypot) {
            return NextResponse.json({ ok: true });
        }

        if (!conversationId || !UUID_RE.test(conversationId)) {
            return NextResponse.json({ error: 'Invalid conversationId' }, { status: 400 });
        }
        if (!messageBody) {
            return NextResponse.json({ error: 'Message is required' }, { status: 400 });
        }
        if (messageBody.length > MAX_BODY_LEN) {
            return NextResponse.json({ error: `Message too long (max ${MAX_BODY_LEN} chars)` }, { status: 400 });
        }

        const db = await getDb();
        if (!db) {
            return NextResponse.json({ error: 'Database unavailable' }, { status: 500 });
        }

        const session = await auth();
        const userEmail = session?.user?.email || null;
        const effectiveLabel = userEmail || userLabel || 'anon';

        const now = Date.now();
        const existing = await db.select().from(chatConversations).where(eq(chatConversations.id, conversationId)).get();

        // Blocked conversations: silently drop. Don't leak block status to abusers.
        if (existing?.blocked) {
            logger.warn('chat.POST: dropped message on blocked conversation', { conversationId });
            return NextResponse.json({ ok: true });
        }

        // Rate limit
        if (existing?.lastMessageAt) {
            const last = existing.lastMessageAt instanceof Date ? existing.lastMessageAt.getTime() : Number(existing.lastMessageAt) * 1000;
            if (now - last < RATE_LIMIT_MIN_GAP_MS) {
                return NextResponse.json({ error: 'Slow down — please wait a moment.' }, { status: 429 });
            }
        }
        let hourCount = existing?.hourCount ?? 0;
        let hourWindowStart = existing?.hourWindowStart instanceof Date
            ? existing.hourWindowStart.getTime()
            : (existing?.hourWindowStart ? Number(existing.hourWindowStart) * 1000 : 0);
        if (!hourWindowStart || now - hourWindowStart > RATE_LIMIT_HOUR_WINDOW_MS) {
            hourCount = 0;
            hourWindowStart = now;
        }
        if (hourCount >= RATE_LIMIT_HOUR_MAX) {
            return NextResponse.json({ error: 'Too many messages this hour. Try again later.' }, { status: 429 });
        }

        // Upsert conversation
        if (existing) {
            await db.update(chatConversations).set({
                userEmail: userEmail ?? existing.userEmail,
                userLabel: effectiveLabel,
                lastMessageAt: new Date(now),
                hourCount: hourCount + 1,
                hourWindowStart: new Date(hourWindowStart),
            }).where(eq(chatConversations.id, conversationId));
        } else {
            await db.insert(chatConversations).values({
                id: conversationId,
                userEmail,
                userLabel: effectiveLabel,
                lastMessageAt: new Date(now),
                hourCount: 1,
                hourWindowStart: new Date(now),
                blocked: 0,
            });
        }

        const messageId = crypto.randomUUID();
        await db.insert(chatMessages).values({
            id: messageId,
            conversationId,
            direction: 'user',
            body: messageBody,
        });

        // Forward to admin's Telegram. Failure here doesn't fail the user
        // request — we still recorded the message; admin will see it on
        // their next /api/chat poll if they're also reading from the app
        // side, and the failure is logged for triage.
        let telegramMessageId: number | undefined;
        if (isTelegramConfigured()) {
            const adminChatId = await getAdminChatId(db);
            if (!adminChatId) {
                logger.warn('chat.POST: TELEGRAM_ADMIN_CHAT_ID not set in appConfig', { conversationId });
            } else {
                const text = formatForwardedMessage(conversationId, effectiveLabel, messageBody);
                const tg = await sendTelegramMessage(adminChatId, text);
                if (tg.ok && tg.messageId) {
                    telegramMessageId = tg.messageId;
                    await db.update(chatMessages).set({ telegramMessageId }).where(eq(chatMessages.id, messageId));
                } else {
                    logger.warn('chat.POST: telegram forward failed', { conversationId, error: tg.error });
                }
            }
        } else {
            logger.warn('chat.POST: TELEGRAM_BOT_TOKEN not set; message stored but not forwarded', { conversationId });
        }

        return NextResponse.json({ ok: true, id: messageId });
    } catch (e) {
        const errorId = logger.error('chat.POST failed', e, { conversationId });
        return NextResponse.json({ error: 'Failed to send message', errorId }, { status: 500 });
    }
}

export async function GET(request: NextRequest) {
    const conversationId = request.nextUrl.searchParams.get('conversationId') || '';
    const sinceParam = request.nextUrl.searchParams.get('since');
    try {
        if (!(await getFeatureFlag('ENABLE_CHAT_WIDGET'))) {
            return NextResponse.json({ messages: [] });
        }
        if (!UUID_RE.test(conversationId)) {
            return NextResponse.json({ error: 'Invalid conversationId' }, { status: 400 });
        }
        const db = await getDb();
        if (!db) {
            return NextResponse.json({ error: 'Database unavailable' }, { status: 500 });
        }

        const since = sinceParam ? new Date(Number(sinceParam)) : new Date(0);
        const rows = await db.select().from(chatMessages)
            .where(and(eq(chatMessages.conversationId, conversationId), gt(chatMessages.createdAt, since)))
            .orderBy(asc(chatMessages.createdAt));

        type MsgRow = typeof chatMessages.$inferSelect;
        return NextResponse.json({
            messages: (rows as MsgRow[]).map((r: MsgRow) => ({
                id: r.id,
                direction: r.direction,
                body: r.body,
                createdAt: r.createdAt instanceof Date ? r.createdAt.getTime() : Number(r.createdAt) * 1000,
            })),
        });
    } catch (e) {
        const errorId = logger.error('chat.GET failed', e, { conversationId });
        return NextResponse.json({ error: 'Failed to load messages', errorId }, { status: 500 });
    }
}
