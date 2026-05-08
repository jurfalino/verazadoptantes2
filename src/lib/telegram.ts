/**
 * Telegram Bot API client + webhook helpers.
 *
 * Used by the support-chat feature: outbound `sendTelegramMessage` forwards
 * user messages to the admin's personal chat; inbound webhook calls
 * `verifyWebhookSecret` before processing the admin's reply.
 *
 * Secret resolution (DB-first, Cloudflare-secret fallback):
 *   1. Read `appConfig` rows for TELEGRAM_BOT_TOKEN / TELEGRAM_WEBHOOK_SECRET
 *      / TELEGRAM_ADMIN_CHAT_ID.
 *   2. If empty, fall back to the Cloudflare runtime env (set via
 *      `wrangler pages secret put`), which never reaches client code.
 *   3. process.env fallback for local dev only.
 *
 * The DB path lets the admin configure everything from /admin/config without
 * shell access. The env path is the more-secure default for fresh deploys.
 *
 * Privacy: this module is the only outbound contact with Telegram. Browsers
 * never reach api.telegram.org and the admin's Telegram client never reaches
 * the user's browser, so the admin's IP cannot leak to the user.
 */

import { getRequestContext } from '@cloudflare/next-on-pages';
import { eq } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { appConfig } from '@/db/schema';
import { getDb } from '@/lib/db';

const TELEGRAM_API = 'https://api.telegram.org';

export interface TelegramConfig {
    botToken: string;
    webhookSecret: string;
    adminChatId: string;
}

function readEnv(name: string): string {
    try {
        const ctx = getRequestContext();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const env = (ctx?.env ?? {}) as Record<string, any>;
        if (typeof env[name] === 'string' && env[name]) return env[name] as string;
    } catch { /* not in Cloudflare context */ }
    return process.env[name] || '';
}

/**
 * Read all three Telegram config values. DB takes precedence per row, so an
 * admin can override any single value (typically the chat_id) while leaving
 * others as Cloudflare-managed secrets.
 */
export async function getTelegramConfig(): Promise<TelegramConfig> {
    const fromEnv: TelegramConfig = {
        botToken: readEnv('TELEGRAM_BOT_TOKEN'),
        webhookSecret: readEnv('TELEGRAM_WEBHOOK_SECRET'),
        adminChatId: readEnv('TELEGRAM_ADMIN_CHAT_ID'),
    };
    try {
        const db = await getDb();
        if (!db) return fromEnv;
        const keys = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'TELEGRAM_ADMIN_CHAT_ID'] as const;
        const rows = await Promise.all(keys.map(k =>
            db.select().from(appConfig).where(eq(appConfig.key, k)).get()
        ));
        return {
            botToken: rows[0]?.value || fromEnv.botToken,
            webhookSecret: rows[1]?.value || fromEnv.webhookSecret,
            adminChatId: rows[2]?.value || fromEnv.adminChatId,
        };
    } catch {
        return fromEnv;
    }
}

/**
 * True iff the bot token is configured (DB or env). Callers can short-circuit
 * before doing DB work when the integration isn't set up.
 */
export async function isTelegramConfigured(): Promise<boolean> {
    const cfg = await getTelegramConfig();
    return !!cfg.botToken;
}

/**
 * Verify Telegram's `X-Telegram-Bot-Api-Secret-Token` header matches the
 * secret we passed to `setWebhook`. This is the only authenticator on the
 * inbound webhook — without it, anyone could forge admin replies.
 */
export async function verifyWebhookSecret(headers: Headers): Promise<boolean> {
    const provided = headers.get('x-telegram-bot-api-secret-token');
    const { webhookSecret } = await getTelegramConfig();
    if (!webhookSecret || !provided) return false;
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
export async function sendTelegramMessage(chatId: string, text: string, configOverride?: TelegramConfig): Promise<SendMessageResult> {
    const cfg = configOverride ?? await getTelegramConfig();
    if (!cfg.botToken) {
        return { ok: false, error: 'TELEGRAM_BOT_TOKEN not set' };
    }
    if (!chatId) {
        return { ok: false, error: 'admin chat_id not configured' };
    }
    try {
        const res = await fetch(`${TELEGRAM_API}/bot${cfg.botToken}/sendMessage`, {
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

interface RegisterWebhookResult {
    ok: boolean;
    error?: string;
    description?: string;
}

/**
 * Register the inbound webhook with Telegram. Idempotent — calling it again
 * just overwrites the previous URL/secret. Used by the admin "Save & register"
 * button so the webhook can be set without the operator running a curl
 * command.
 */
export async function registerWebhook(webhookUrl: string, configOverride?: TelegramConfig): Promise<RegisterWebhookResult> {
    const cfg = configOverride ?? await getTelegramConfig();
    if (!cfg.botToken) return { ok: false, error: 'TELEGRAM_BOT_TOKEN not set' };
    if (!cfg.webhookSecret) return { ok: false, error: 'TELEGRAM_WEBHOOK_SECRET not set' };
    if (!webhookUrl.startsWith('https://')) return { ok: false, error: 'webhook URL must be https' };
    try {
        const res = await fetch(`${TELEGRAM_API}/bot${cfg.botToken}/setWebhook`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                url: webhookUrl,
                secret_token: cfg.webhookSecret,
                drop_pending_updates: false,
            }),
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const json: any = await res.json().catch(() => ({}));
        if (!res.ok || !json?.ok) {
            const errorMsg = json?.description || `HTTP ${res.status}`;
            logger.warn('telegram.registerWebhook failed', { url: webhookUrl, status: res.status, error: errorMsg });
            return { ok: false, error: errorMsg };
        }
        logger.info('telegram.registerWebhook success', { url: webhookUrl, description: json.description });
        return { ok: true, description: json.description };
    } catch (e) {
        logger.error('telegram.registerWebhook threw', e, { url: webhookUrl });
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
    const safeBody = body.slice(0, 3500);
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
