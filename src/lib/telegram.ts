/**
 * Telegram Bot API client + webhook helpers.
 *
 * Used by the support-chat feature: outbound `sendMessage` forwards user
 * messages to the admin's personal chat; inbound webhook calls
 * `verifyWebhookSecret` before processing the admin's reply.
 *
 * Secrets are read from the Cloudflare runtime env (`getRequestContext().env`)
 * with a `process.env` fallback for local dev — same pattern as `gemini.ts`.
 *
 * Privacy: this module is the only outbound contact with Telegram. Browsers
 * never reach api.telegram.org and the admin's Telegram client never reaches
 * the user's browser, so the admin's IP cannot leak to the user.
 */

import { getRequestContext } from '@cloudflare/next-on-pages';
import { logger } from '@/lib/logger';

const TELEGRAM_API = 'https://api.telegram.org';

interface TelegramSecrets {
    botToken: string;
    webhookSecret: string;
}

function getTelegramSecrets(): TelegramSecrets {
    let env: Record<string, string | undefined> | undefined;
    try {
        const ctx = getRequestContext();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        env = (ctx?.env ?? {}) as any;
    } catch {
        env = undefined;
    }
    const botToken = env?.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';
    const webhookSecret = env?.TELEGRAM_WEBHOOK_SECRET || process.env.TELEGRAM_WEBHOOK_SECRET || '';
    return { botToken, webhookSecret };
}

/**
 * True iff the bot token is configured. Callers can short-circuit before
 * doing DB work when the integration isn't set up — the chat feature flag
 * gates the UI but the API endpoints should still degrade gracefully.
 */
export function isTelegramConfigured(): boolean {
    return !!getTelegramSecrets().botToken;
}

/**
 * Verify Telegram's `X-Telegram-Bot-Api-Secret-Token` header matches the
 * secret we passed to `setWebhook`. This is the only authenticator on the
 * inbound webhook — without it, anyone could forge admin replies.
 */
export function verifyWebhookSecret(headers: Headers): boolean {
    const provided = headers.get('x-telegram-bot-api-secret-token');
    const { webhookSecret } = getTelegramSecrets();
    if (!webhookSecret || !provided) return false;
    // Constant-time-ish compare — not perfectly timing-safe in JS but
    // close enough for a secret of this size + the request rate.
    if (provided.length !== webhookSecret.length) return false;
    let mismatch = 0;
    for (let i = 0; i < provided.length; i++) {
        mismatch |= provided.charCodeAt(i) ^ webhookSecret.charCodeAt(i);
    }
    return mismatch === 0;
}

interface SendMessageResult {
    ok: boolean;
    messageId?: number;
    error?: string;
}

/**
 * Send a plain-text message to a chat. Returns the Telegram-side `message_id`
 * on success — the caller should persist it on the user-direction
 * `chat_messages` row so the admin can use Telegram's Reply gesture and the
 * webhook can extract `message.reply_to_message.text` to route the reply.
 */
export async function sendTelegramMessage(chatId: string, text: string): Promise<SendMessageResult> {
    const { botToken } = getTelegramSecrets();
    if (!botToken) {
        return { ok: false, error: 'TELEGRAM_BOT_TOKEN not set' };
    }
    if (!chatId) {
        return { ok: false, error: 'admin chat_id not configured' };
    }
    try {
        const res = await fetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text,
                disable_web_page_preview: true,
            }),
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const json: any = await res.json().catch(() => ({}));
        if (!res.ok || !json?.ok) {
            const errorMsg = json?.description || `HTTP ${res.status}`;
            logger.warn('telegram.sendMessage failed', { chatId: maskChatId(chatId), status: res.status, error: errorMsg });
            return { ok: false, error: errorMsg };
        }
        return { ok: true, messageId: json.result?.message_id };
    } catch (e) {
        logger.error('telegram.sendMessage threw', e, { chatId: maskChatId(chatId) });
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}

/**
 * Format a user-direction message for display in the admin's Telegram. The
 * `[#xxxxxxxx]` prefix is the routing token — extracted from
 * `reply_to_message.text` on the way back. Keep the first 8 chars of the
 * conversation UUID (122 bits → 32 bits is still ~4B distinct conversations,
 * collision-free for this scale).
 */
export function formatForwardedMessage(conversationId: string, label: string, body: string): string {
    const tag = conversationId.replace(/-/g, '').slice(0, 8);
    const safeLabel = (label || 'anon').slice(0, 80);
    const safeBody = body.slice(0, 3500); // Telegram limit is 4096; leave headroom for prefix
    return `[#${tag}] ${safeLabel}\n${safeBody}`;
}

/**
 * Extract the conversation tag from an admin reply. We look at
 * `reply_to_message.text` (the bot's forwarded message) and pull out the
 * leading `[#xxxxxxxx]`. Returns null if the admin replied without using
 * the Reply gesture or the prefix can't be parsed.
 */
export function extractConversationTag(replyToText: string | null | undefined): string | null {
    if (!replyToText) return null;
    const m = /^\[#([0-9a-f]{8})\]/.exec(replyToText);
    return m ? m[1] : null;
}

function maskChatId(chatId: string): string {
    if (chatId.length <= 4) return '****';
    return `***${chatId.slice(-3)}`;
}
