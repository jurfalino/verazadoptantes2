/**
 * Email twin of every in-app notification, governed by the per-category
 * switches in user_profiles.email_prefs. NOT a 'use server' module.
 * `notifications.user_id` is the recipient EMAIL.
 */
import { and, desc, eq, gte, isNotNull } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { notifications } from '@/db/schema';
import { logger } from '@/lib/logger';
import { maskEmail } from '@/lib/dates';
import { ALWAYS_ON_CATEGORIES, categoryForType, isEmailEnabled } from '@/domain/emailCategories';
import { getEmailPrefsForEmail } from '@/lib/emailPrefs';
import { appBaseUrl, resolveEmailConfig } from '@/lib/emailConfig';
import { buildNotificationEmail, sendEmailViaResend } from '@/lib/email';
import { unsubscribeUrl } from '@/lib/emailUnsubscribe';
import { resolveAuthSecret } from '@/lib/otp';

export type NotificationEmailResult = 'sent' | 'skipped_pref' | 'skipped_throttle' | 'skipped_config' | 'failed';

const THROTTLE_MS = 10 * 60_000;
const THROTTLE_SCAN_LIMIT = 50;

export async function sendNotificationEmail(n: {
    id: string; userId: string; type: string; title: string; body: string; url?: string | null;
}): Promise<NotificationEmailResult> {
    const category = categoryForType(n.type);
    const db = await getDb();

    // 1. Preference switch.
    const prefs = await getEmailPrefsForEmail(db, n.userId);
    if (!isEmailEnabled(prefs, category)) return 'skipped_pref';

    // 2. One email per category per 10 minutes (always-on category exempt).
    //    D1-safe: bounded scan of recent emailed rows, categories mapped in JS.
    if (!ALWAYS_ON_CATEGORIES.has(category)) {
        const since = new Date(Date.now() - THROTTLE_MS);
        const recent = await db.select({ type: notifications.type })
            .from(notifications)
            .where(and(eq(notifications.userId, n.userId), isNotNull(notifications.emailedAt), gte(notifications.emailedAt, since)))
            .orderBy(desc(notifications.emailedAt))
            .limit(THROTTLE_SCAN_LIMIT);
        if (recent.some((r: { type: string }) => categoryForType(r.type) === category)) return 'skipped_throttle';
    }

    // 3. Resend config.
    const { apiKey, from } = await resolveEmailConfig(db);
    if (!apiKey) {
        const log = process.env.NODE_ENV === 'production' ? logger.warn : logger.info;
        log.call(logger, 'sendNotificationEmail: no RESEND_API_KEY, send skipped', { notificationId: n.id, type: n.type });
        return 'skipped_config';
    }

    // 4. Send.
    const base = appBaseUrl();
    const unsub = ALWAYS_ON_CATEGORIES.has(category)
        ? null
        : await unsubscribeUrl(base, n.userId, category, resolveAuthSecret());
    const message = buildNotificationEmail({ title: n.title, body: n.body, url: n.url ?? null }, { appBaseUrl: base, unsubscribeUrl: unsub });
    const sent = await sendEmailViaResend({ apiKey, from, to: n.userId, ...message });
    if (!sent.ok) {
        logger.warn('sendNotificationEmail: send failed', { notificationId: n.id, type: n.type, errorId: sent.errorId, to: maskEmail(n.userId) });
        return 'failed';
    }
    await db.update(notifications).set({ emailedAt: new Date() }).where(eq(notifications.id, n.id));
    return 'sent';
}
