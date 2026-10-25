/**
 * Email twin of every in-app notification, governed by the
 * ENABLE_NOTIFICATION_EMAIL kill switch and the per-category switches in
 * user_profiles.email_prefs. Only registered recipients (a `user` row) are
 * emailed. NOT a 'use server' module.
 * `notifications.user_id` is the recipient EMAIL.
 */
import { and, desc, eq, gte, isNotNull } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { notifications } from '@/db/schema';
import { logger } from '@/lib/logger';
import { maskEmail } from '@/lib/dates';
import { ALWAYS_ON_CATEGORIES, categoryForType, emailThrottleKey, isEmailEnabled } from '@/domain/emailCategories';
import { getEmailRecipient, getLocaleForEmail } from '@/lib/emailPrefs';
import { getFeatureFlag } from '@/config/features';
import { appBaseUrl, isStagingEnvironment, resolveEmailConfig } from '@/lib/emailConfig';
import { buildNotificationEmail, sendEmailViaResend } from '@/lib/email';
import { unsubscribeUrl } from '@/lib/emailUnsubscribe';
import { resolveAuthSecret } from '@/lib/otp';

export type NotificationEmailResult =
    | 'sent' | 'skipped_disabled' | 'skipped_no_account' | 'skipped_pref' | 'skipped_throttle' | 'skipped_config' | 'failed';

const THROTTLE_MS = 10 * 60_000;
const THROTTLE_SCAN_LIMIT = 50;

export async function sendNotificationEmail(n: {
    id: string; userId: string; type: string; title: string; body: string; url?: string | null;
}): Promise<NotificationEmailResult> {
    // 0. Emergency off switch (Admin → config). Shares Resend with OTP login,
    //    so a runaway sender can be stopped without taking login down.
    if (!(await getFeatureFlag('ENABLE_NOTIFICATION_EMAIL'))) return 'skipped_disabled';

    const category = categoryForType(n.type);
    const db = await getDb();

    // 1. Only registered people: without a `user` row nobody can manage the
    //    switches, and the unsubscribe link would always fail.
    const recipient = await getEmailRecipient(db, n.userId);
    if (!recipient) {
        logger.info('sendNotificationEmail: no account for the recipient, send skipped', { notificationId: n.id, type: n.type, to: maskEmail(n.userId) });
        return 'skipped_no_account';
    }

    // 2. Preference switch.
    if (!isEmailEnabled(recipient.prefs, category)) return 'skipped_pref';

    // 3. One email per throttle key per 10 minutes (merge_request exempt;
    //    see emailThrottleKey). D1-safe: bounded scan of recent emailed rows,
    //    keys mapped in JS.
    const throttleKey = emailThrottleKey(n.type);
    if (throttleKey) {
        const since = new Date(Date.now() - THROTTLE_MS);
        const recent = await db.select({ type: notifications.type })
            .from(notifications)
            .where(and(eq(notifications.userId, n.userId), isNotNull(notifications.emailedAt), gte(notifications.emailedAt, since)))
            .orderBy(desc(notifications.emailedAt))
            .limit(THROTTLE_SCAN_LIMIT);
        if (recent.some((r: { type: string }) => emailThrottleKey(r.type) === throttleKey)) return 'skipped_throttle';
    }

    // 4. Resend config.
    const { apiKey, from } = await resolveEmailConfig(db);
    if (!apiKey) {
        const log = process.env.NODE_ENV === 'production' ? logger.warn : logger.info;
        log.call(logger, 'sendNotificationEmail: no RESEND_API_KEY, send skipped', { notificationId: n.id, type: n.type });
        return 'skipped_config';
    }

    // 5. Send.
    const base = appBaseUrl();
    const unsub = ALWAYS_ON_CATEGORIES.has(category)
        ? null
        : await unsubscribeUrl(base, n.userId, category, resolveAuthSecret());
    const message = buildNotificationEmail({ title: n.title, body: n.body, url: n.url ?? null }, { appBaseUrl: base, unsubscribeUrl: unsub },
        { locale: await getLocaleForEmail(db, n.userId), staging: isStagingEnvironment() });
    const sent = await sendEmailViaResend({ apiKey, from, to: n.userId, ...message });
    if (!sent.ok) {
        logger.warn('sendNotificationEmail: send failed', { notificationId: n.id, type: n.type, errorId: sent.errorId, to: maskEmail(n.userId) });
        return 'failed';
    }
    await db.update(notifications).set({ emailedAt: new Date() }).where(eq(notifications.id, n.id));
    return 'sent';
}
