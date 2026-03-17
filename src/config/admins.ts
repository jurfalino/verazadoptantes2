import { getRequestContext } from '@cloudflare/next-on-pages';

// Bootstrap admin — this email always has admin access even before
// the database is available (e.g. first deploy, build time).
// Additional admins should be granted via the user_profiles.role column
// (set role='admin' via the admin SQL runner).
export const BOOTSTRAP_ADMIN_EMAILS = [
    'gatitosolivos@gmail.com',
];

/**
 * Synchronous check: returns true if the email is in the bootstrap list.
 * Use this in contexts where async DB access is not possible (e.g. client components).
 */
export function isAdmin(email: string | null | undefined): boolean {
    if (!email) return false;
    return BOOTSTRAP_ADMIN_EMAILS.includes(email);
}

/**
 * Async check: returns true if the email is a bootstrap admin OR has role='admin'
 * in the user_profiles table.  Falls back to the bootstrap list if the DB is unavailable.
 *
 * To grant admin access to a new user, run this SQL in the admin SQL runner:
 *   UPDATE user_profiles SET role = 'admin' WHERE user_id = (SELECT id FROM user WHERE email = 'user@example.com');
 */
export async function isAdminAsync(email: string | null | undefined): Promise<boolean> {
    if (!email) return false;

    // Bootstrap admins always pass
    if (BOOTSTRAP_ADMIN_EMAILS.includes(email)) return true;

    // Check DB role via raw D1 query (auth tables aren't in Drizzle schema)
    try {
        const { env } = getRequestContext();
        if (!env?.DB) return false;

        const result = await env.DB.prepare(
            `SELECT up.role FROM user_profiles up
             INNER JOIN user u ON u.id = up.user_id
             WHERE u.email = ? LIMIT 1`
        ).bind(email).first<{ role: string }>();

        return result?.role === 'admin';
    } catch {
        // DB unavailable (build time, local dev) — fall back to bootstrap list only
        return false;
    }
}
