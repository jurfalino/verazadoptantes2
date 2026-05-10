/**
 * Admin-only Telegram setup endpoint.
 *
 * POST: optionally upserts any of the three Telegram values (chat_id, bot
 * token, webhook secret) into appConfig, then calls Telegram's setWebhook
 * with the current host. Lets the operator finish the entire integration
 * from /admin/config without touching wrangler/curl.
 *
 * Request body fields are all optional — pass only the values you want to
 * update. Empty string clears the DB row (which then falls back to the
 * Cloudflare secret, if any).
 *
 * The "registerWebhook" flag controls whether we call Telegram's setWebhook
 * after the upsert. False is useful when the admin only wants to update the
 * chat_id and the webhook is already registered.
 */

export const runtime = 'edge';

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { isAdminAsync } from '@/config/admins';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { appConfig } from '@/db/schema';
import { getTelegramConfig, registerWebhook } from '@/lib/telegram';

const KEYS = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'TELEGRAM_ADMIN_CHAT_ID'] as const;
type ConfigKey = typeof KEYS[number];

export async function POST(request: NextRequest) {
    try {
        const session = await auth();
        const actor = session?.user?.email;
        if (!actor || !await isAdminAsync(actor)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const db = await getDb();
        if (!db) {
            return NextResponse.json({ error: 'Database unavailable' }, { status: 500 });
        }

        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const updates: Partial<Record<ConfigKey, string>> = {};
        for (const k of KEYS) {
            if (typeof body[k] === 'string') {
                updates[k] = (body[k] as string).trim();
            }
        }
        const shouldRegister = body.registerWebhook !== false; // default true

        // Upsert any provided values. Empty string deletes the row so the
        // Cloudflare secret fallback (if any) takes over.
        for (const [key, value] of Object.entries(updates)) {
            if (value === '') {
                await db.delete(appConfig).where(eq(appConfig.key, key));
            } else {
                await db.insert(appConfig)
                    .values({ key, value: value!, updatedAt: new Date(), updatedBy: actor })
                    .onConflictDoUpdate({
                        target: appConfig.key,
                        set: { value: value!, updatedAt: new Date(), updatedBy: actor },
                    });
            }
        }

        const cfg = await getTelegramConfig();
        const status = {
            botTokenSet: !!cfg.botToken,
            webhookSecretSet: !!cfg.webhookSecret,
            adminChatIdSet: !!cfg.adminChatId,
        };

        let webhook: { ok: boolean; error?: string; description?: string; url?: string } | null = null;
        if (shouldRegister) {
            if (!cfg.botToken || !cfg.webhookSecret) {
                webhook = { ok: false, error: 'Bot token and webhook secret must both be set before registering the webhook.' };
            } else {
                // Derive webhook URL from the request host. Forwarded headers
                // (`x-forwarded-host`, `x-forwarded-proto`) are honored — both
                // Cloudflare Pages and local dev populate these correctly.
                const proto = request.headers.get('x-forwarded-proto') || 'https';
                const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
                if (!host) {
                    webhook = { ok: false, error: 'Could not determine host for webhook URL.' };
                } else {
                    const webhookUrl = `${proto}://${host}/api/telegram/webhook`;
                    const result = await registerWebhook(webhookUrl, cfg);
                    webhook = { ...result, url: webhookUrl };
                }
            }
        }

        logger.info('telegram.setup: admin updated config', {
            actor,
            updatedKeys: Object.keys(updates),
            webhookRegistered: webhook?.ok ?? null,
        });

        return NextResponse.json({ ok: true, status, webhook });
    } catch (e) {
        const errorId = logger.error('telegram.setup failed', e);
        return NextResponse.json({ error: 'Setup failed', errorId }, { status: 500 });
    }
}
