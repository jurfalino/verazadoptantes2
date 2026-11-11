/**
 * The per-type notification kill switch: the `app_config` row
 * `NOTIF_ENABLED_<type>` that /admin/notifications writes ('true' / 'false').
 * No row means ON; only an explicit 'false' turns the type off.
 *
 * One rule for its three readers: createNotification, the admin page's API
 * and the follow-up cron Worker (workers/followup-cron), which bundles this
 * file by relative path — keep it pure and free of `@/` imports.
 */

export function notificationKillSwitchKey(type: string): string {
    return `NOTIF_ENABLED_${type}`;
}

export function notificationTypeEnabled(raw: string | null | undefined): boolean {
    return raw !== 'false';
}
