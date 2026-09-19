/**
 * Whether a notification's recipient actually saw it — for the admin view of
 * triggered notifications. Pure; the two flags live on the `notifications` row.
 *
 *   seen       the recipient opened it (or marked it read)
 *   dismissed  cleared from their list without opening it: they looked, they did
 *              not follow it
 *   unseen     still waiting in their bell
 */
export type NotificationSeenState = 'seen' | 'dismissed' | 'unseen';

type Flag = number | boolean | string | null | undefined;
const on = (v: Flag) => v === 1 || v === true || v === '1';

export function notificationSeenState(n: { read: Flag; dismissed: Flag }): NotificationSeenState {
    if (on(n.read)) return 'seen';
    if (on(n.dismissed)) return 'dismissed';
    return 'unseen';
}

export function summariseSeen(rows: Array<{ read: Flag; dismissed: Flag }>): Record<NotificationSeenState, number> {
    const out: Record<NotificationSeenState, number> = { seen: 0, dismissed: 0, unseen: 0 };
    for (const r of rows) out[notificationSeenState(r)]++;
    return out;
}
