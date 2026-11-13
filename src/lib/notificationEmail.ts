/**
 * Email twin of the in-app notifications, governed by the
 * ENABLE_NOTIFICATION_EMAIL kill switch and the «Avisos» rows
 * (src/domain/noticeRows.ts): always for the rows someone waits on, else the
 * row's switch in user_profiles.email_prefs. A caller can make one copy bell
 * only (`bellOnly`: a team copy, the admins' copy of a report). Only registered recipients (a `user` row) are
 * emailed. A local run (no CI stamp) never sends (D53). NOT a 'use server' module.
 * `notifications.user_id` is the recipient EMAIL.
 */
import { and, desc, eq, gte, isNotNull } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { notifications } from '@/db/schema';
import { logger } from '@/lib/logger';
import { maskEmail } from '@/lib/dates';
import { ADMIN_ONLY_TYPES, noticeEmailVerdict, noticeThrottleKey, rowForType, unsubscribableRow } from '@/domain/noticeRows';
import { getEmailRecipient, getLocaleForEmail } from '@/lib/emailPrefs';
import { getFeatureFlag } from '@/config/features';
import { appBaseUrl, isLocalRun, isStagingEnvironment, resolveEmailConfig } from '@/lib/emailConfig';
import { buildNotificationEmail, sendEmailViaResend } from '@/lib/email';
import { unsubscribeUrl } from '@/lib/emailUnsubscribe';
import { resolveAuthSecret } from '@/lib/otp';
import { localizedNotification } from '@/domain/notificationTemplates';
import { renameUndoPath } from '@/domain/profileIdentity';
import type { EmailLocale } from '@/lib/email';

export type NotificationEmailResult =
    | 'sent' | 'skipped_admin_only' | 'skipped_bell_only' | 'skipped_not_emailed' | 'skipped_disabled' | 'skipped_no_account' | 'skipped_pref' | 'skipped_throttle' | 'skipped_config' | 'skipped_local' | 'failed';

const THROTTLE_MS = 10 * 60_000;
const THROTTLE_SCAN_LIMIT = 50;

const EMAIL_SHAPE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

function replyToFor(type: string, metadata: Record<string, unknown> | null | undefined): string | undefined {
    if (type !== 'pair_message') return undefined;
    const v = metadata?.replyTo;
    return typeof v === 'string' && EMAIL_SHAPE.test(v) ? v : undefined;
}

export async function sendNotificationEmail(n: {
    id: string; userId: string; type: string; title: string; body: string; url?: string | null; metadata?: Record<string, unknown> | null;
    /** This copy stays in the bell (the caller decided: a team copy, the admins' copy of a report). */
    bellOnly?: boolean;
}): Promise<NotificationEmailResult> {
    // Admin-queue items and bell-only copies have no email twin.
    if (ADMIN_ONLY_TYPES.includes(n.type)) return 'skipped_admin_only';
    if (n.bellOnly) return 'skipped_bell_only';

    // 0. Emergency off switch (Admin → config). Shares Resend with OTP login,
    //    so a runaway sender can be stopped without taking login down.
    if (!(await getFeatureFlag('ENABLE_NOTIFICATION_EMAIL'))) return 'skipped_disabled';

    // Types with no email twin (check-ups have their own digest).
    if (noticeEmailVerdict({ type: n.type, metadata: n.metadata }, {}) === 'not_emailed') return 'skipped_not_emailed';
    const db = await getDb();

    // 1. Only registered people: without a `user` row nobody can manage the
    //    switches, and the unsubscribe link would always fail.
    const recipient = await getEmailRecipient(db, n.userId);
    if (!recipient) {
        logger.info('sendNotificationEmail: no account for the recipient, send skipped', { notificationId: n.id, type: n.type, to: maskEmail(n.userId) });
        return 'skipped_no_account';
    }

    // 2. The row's switch (always on for the rows someone waits on).
    if (noticeEmailVerdict({ type: n.type, metadata: n.metadata }, recipient.prefs) !== 'send') return 'skipped_pref';

    // 3. One email per throttle key per 10 minutes (merge_request exempt;
    //    see noticeThrottleKey). D1-safe: bounded scan of recent emailed rows,
    //    keys mapped in JS.
    const throttleKey = noticeThrottleKey(n.type);
    if (throttleKey) {
        const since = new Date(Date.now() - THROTTLE_MS);
        const recent = await db.select({ type: notifications.type })
            .from(notifications)
            .where(and(eq(notifications.userId, n.userId), isNotNull(notifications.emailedAt), gte(notifications.emailedAt, since)))
            .orderBy(desc(notifications.emailedAt))
            .limit(THROTTLE_SCAN_LIMIT);
        if (recent.some((r: { type: string }) => noticeThrottleKey(r.type) === throttleKey)) return 'skipped_throttle';
    }

    // 4. Resend config.
    const { apiKey, from } = await resolveEmailConfig(db);
    if (!apiKey) {
        const log = process.env.NODE_ENV === 'production' ? logger.warn : logger.info;
        log.call(logger, 'sendNotificationEmail: no RESEND_API_KEY, send skipped', { notificationId: n.id, type: n.type });
        return 'skipped_config';
    }

    // 5. Local runs never email (D53): only builds CI stamped (staging,
    //    production) reach real inboxes — a developer's .env.local may carry
    //    a real key. EMAIL_ALLOW_LOCAL=1 opts in, for testing the email itself.
    if (isLocalRun() && process.env.EMAIL_ALLOW_LOCAL !== '1') {
        logger.info('sendNotificationEmail: local run, send skipped (EMAIL_ALLOW_LOCAL=1 to allow)', { notificationId: n.id, type: n.type });
        return 'skipped_local';
    }

    // 6. Send.
    const base = appBaseUrl();
    // A switchable row's email carries a link that switches that row off.
    const unsubRow = unsubscribableRow(rowForType(n.type)?.key ?? '');
    const unsub = unsubRow ? await unsubscribeUrl(base, n.userId, unsubRow, resolveAuthSecret()) : null;
    // The recipient's language (D38). A failed lookup must not cost the email: Spanish, logged.
    let locale: EmailLocale = 'es';
    try {
        locale = await getLocaleForEmail(db, n.userId);
    } catch (e) {
        logger.warn('sendNotificationEmail: locale lookup failed, sending in Spanish', {
            notificationId: n.id, type: n.type, error: e instanceof Error ? e.message : String(e),
        });
    }
    // Subject and body from the template in that language; the stored Spanish text otherwise.
    const text = localizedNotification({ title: n.title, body: n.body, metadata: n.metadata }, locale);
    // A rename notice carries «Deshacer» (metadata.undo): a second button that opens the confirmation on the profile.
    const undoUrl = n.type === 'profile_renamed' ? renameUndoPath(n.metadata) : null;
    const message = buildNotificationEmail({ title: text.title, body: text.body, url: n.url ?? null, undoUrl, notificationId: n.id, type: n.type, recipientUserId: recipient.id }, { appBaseUrl: base, unsubscribeUrl: unsub },
        { locale, staging: isStagingEnvironment() });
    // Only «Escribirle» messages carry a reply-to: the sender chose to be reachable.
    const replyTo = replyToFor(n.type, n.metadata);
    const sent = await sendEmailViaResend({ apiKey, from, to: n.userId, ...message, ...(replyTo ? { replyTo } : {}) });
    if (!sent.ok) {
        logger.warn('sendNotificationEmail: send failed', { notificationId: n.id, type: n.type, errorId: sent.errorId, to: maskEmail(n.userId) });
        return 'failed';
    }
    await db.update(notifications).set({ emailedAt: new Date() }).where(eq(notifications.id, n.id));
    return 'sent';
}
