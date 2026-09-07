import { logger } from '@/lib/logger';
import { DEFAULT_TIMEZONE } from '@/lib/dates';
import { isValidTimezone } from '@/domain/timezones';

/**
 * Server-side resolution of the zone a viewer's dates are rendered in.
 *
 * Source of truth is `user_profiles.timezone`, seeded from the `cf-timezone`
 * header at first sign-in (`src/auth.ts`) and correctable by the user in
 * Configuración. We deliberately do *not* read the live request header here —
 * Cloudflare reports the egress location, so a VPN user gets the wrong zone
 * (`.agents/audits/2026-09-04-vpn-stale-data.md`).
 */

/**
 * Resolve the viewer's zone, never throwing and never blocking a render.
 *
 * Anonymous visitors cost zero queries — they get the default. Signed-in users
 * cost one indexed read, on a layout that already awaits `auth()` and two
 * feature flags.
 */
export async function resolveViewerTimezone(userEmail: string | null | undefined): Promise<string> {
    if (!userEmail || userEmail === 'unknown') return DEFAULT_TIMEZONE;

    try {
        const { env } = (await import('@cloudflare/next-on-pages')).getRequestContext();
        if (!env?.DB) return DEFAULT_TIMEZONE;

        const row = await env.DB.prepare(
            `SELECT up.timezone
             FROM user_profiles up
             JOIN user u ON u.id = up.user_id
             WHERE u.email = ? LIMIT 1`
        ).bind(userEmail).first<{ timezone: string | null }>();

        const stored = row?.timezone;
        if (!stored) return DEFAULT_TIMEZONE;
        if (!isValidTimezone(stored)) {
            logger.warn('resolveViewerTimezone: stored zone is not a valid IANA name', {
                userEmail, stored,
            });
            return DEFAULT_TIMEZONE;
        }
        return stored;
    } catch (e) {
        logger.warn('resolveViewerTimezone: lookup failed, using default', {
            userEmail,
            error: e instanceof Error ? e.message : String(e),
        });
        return DEFAULT_TIMEZONE;
    }
}
