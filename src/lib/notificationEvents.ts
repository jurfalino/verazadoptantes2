import { posthogTrack } from '@/lib/zaraz';
import { notificationClickProps, type EmailLanding, type NotificationClickSource } from '@/domain/notificationTracking';

/**
 * Notification analytics (PostHog only). Which notices get opened, from where,
 * how fast, and which emails bring people back. Properties are types, ids,
 * counts and source only — never titles, bodies, names or emails.
 *
 * `posthogTrack` queues until PostHog's deferred init and is a no-op when
 * PostHog is off (flag, no key, SSR), so callers need no guard.
 */

/** The bell's panel opened. `unreadCount`: the badge at that moment (before the list loads). */
export function trackNotificationBellOpened(unreadCount: number): void {
    posthogTrack('notification_bell_opened', { unread_count: unreadCount });
}

/** A notice's main area was clicked (not dismiss, mark-read or undo). Pass the row as it was BEFORE the click. */
export function trackNotificationClicked(
    item: { id: string; type: string; read: number | boolean; createdAt: number | string | Date | null | undefined },
    source: NotificationClickSource,
): void {
    posthogTrack('notification_clicked', notificationClickProps(item, source, Date.now()));
}

/** Arrived from a link in one of our emails. */
export function trackNotificationEmailClicked(landing: EmailLanding): void {
    posthogTrack('notification_email_clicked', {
        kind: landing.kind,
        ...(landing.notificationId ? { notification_id: landing.notificationId } : {}),
    });
}
