/**
 * Privacy-safe fallback label for a user (rescuer) who has no display name set:
 * the email's local part (the "handle"), NEVER the domain or the full address.
 * e.g. `jonathan@gmail.com` → `jonathan`.
 *
 * Use this everywhere a rescuer's identity is shown to non-admins so we never
 * expose their email — replacing the older `maskEmail` (which leaked the full
 * domain) and raw-email renders. Admin/moderation surfaces intentionally keep the
 * full email and do NOT use this. Matches the `email.split('@')[0]` fallback the
 * server-side name resolvers already use (notifications.ts, piiAccess.ts, …).
 */
export function emailHandle(email: string | null | undefined): string {
    if (!email) return '';
    const at = email.indexOf('@');
    return at > 0 ? email.slice(0, at) : email;
}
