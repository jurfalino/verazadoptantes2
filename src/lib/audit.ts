/**
 * Audit Logger — fire-and-forget audit trail for D1
 * 
 * Uses waitUntil to avoid blocking request handling.
 * Falls back to fire-and-forget if no request context.
 */

import { getRequestContext } from '@cloudflare/next-on-pages';
import { headers } from 'next/headers';
import { logger } from '@/lib/logger';

export interface AuditEntry {
    userId?: string;
    userEmail?: string;
    action: string;
    target?: string;
    details?: Record<string, unknown>;
    device?: string;
    isPWA?: boolean;
    ipAddress?: string;
}

/**
 * Log an audit event to the audit_log table.
 * Non-blocking: uses waitUntil on Edge, fire-and-forget otherwise.
 */
export async function logAudit(entry: AuditEntry) {
    // Capture IP and User-Agent from request headers
    // Must happen before waitUntil, because headers() requires active request context
    let resolvedIp = entry.ipAddress || null;
    let resolvedDevice = entry.device || null;
    try {
        const h = await headers();
        if (h && typeof h.get === 'function') {
            if (!resolvedIp) {
                resolvedIp = h.get('cf-connecting-ip') || h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || null;
            }
            if (!resolvedDevice) {
                resolvedDevice = h.get('user-agent') || null;
            }
        }
    } catch {
        // headers() unavailable outside server request context — skip
    }

    const doInsert = async () => {
        try {
            const { env } = getRequestContext();
            if (!env?.DB) return;

            const id = crypto.randomUUID();
            const details = entry.details ? JSON.stringify(entry.details) : null;

            await env.DB.prepare(
                `INSERT INTO audit_log (id, user_id, user_email, action, target, details, device, is_pwa, ip_address, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s','now'))`
            ).bind(
                id,
                entry.userId || null,
                entry.userEmail || null,
                entry.action,
                entry.target || null,
                details,
                resolvedDevice,
                entry.isPWA ? 1 : 0,
                resolvedIp
            ).run();
        } catch (e) {
            // Never let audit logging break the main flow.
            // Pass `e` directly as the 2nd arg so logger extracts name/message/stack;
            // passing a `{error: ...}` object as 2nd arg made logger stringify it to
            // "[object Object]" (it treats non-Error 2nd arg as `String(error)`).
            logger.error('[Audit] Failed to log', e, { action: entry.action, target: entry.target });
        }
    };

    // Use waitUntil if available (Edge runtime)
    try {
        const { ctx } = getRequestContext();
        if (ctx?.waitUntil) {
            ctx.waitUntil(doInsert());
        } else {
            doInsert(); // fire and forget
        }
    } catch {
        doInsert(); // Not in request context
    }
}

/**
 * Ensure both a NextAuth `user` row and a `user_profiles` row exist.
 * Called on sign-in. NextAuth's DrizzleAdapter is disabled on Edge,
 * so we must insert the user ourselves via raw D1.
 *
 * IMPORTANT: JWT strategy gives a new random user.id per sign-in,
 * so we look up users by EMAIL to prevent duplicate rows.
 *
 * Geo detection: reads CF-IPCountry, cf-region, cf-region-code,
 * cf-ipcity, cf-timezone headers on first sign-in and stores them.
 * Does NOT overwrite on subsequent sign-ins so user changes via
 * settings are preserved.
 *
 * markEmailVerified: set by the email-otp provider — entering a mailed code
 * proves inbox ownership, so stamp user.emailVerified (only when currently
 * NULL, same conditional-backfill policy as `name`). Google sign-ins leave
 * it untouched.
 */
export async function ensureUserProfile(userId: string, email?: string, name?: string, image?: string, markEmailVerified?: boolean) {
    // Read Cloudflare geo headers before waitUntil
    let detectedCountry: string | null = null;
    let detectedProvince: string | null = null;
    let detectedProvinceCode: string | null = null;
    let detectedCity: string | null = null;
    let detectedTimezone: string | null = null;
    try {
        const h = await headers();
        if (h && typeof h.get === 'function') {
            detectedCountry = h.get('cf-ipcountry') || null;
            detectedProvince = h.get('cf-region') || null;
            detectedProvinceCode = h.get('cf-region-code') || null;
            detectedCity = h.get('cf-ipcity') || null;
            detectedTimezone = h.get('cf-timezone') || null;
        }
    } catch { /* headers() unavailable outside server request context */ }

    // Local-dev / Playwright fallback: outside a Cloudflare request context
    // there is no env.DB, and the raw path below used to silently no-op — so
    // dev-login/email-otp sign-ins never created user rows locally and the
    // jwt callback found nothing. Minimal mirror of the upsert (user +
    // user_profiles); geo capture and handle assignment are CF-bound and
    // intentionally skipped.
    const doUpsertLocal = async () => {
        try {
            if (!email) return; // email-keyed upsert only; CF path handles the id-only edge
            const { getDb } = await import('@/lib/db');
            const db = await getDb();
            if (!db) return;
            const { users, userProfiles } = await import('@/db/schema');
            const { eq } = await import('drizzle-orm');
            let resolvedId = userId;
            const existing = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
            if (existing) {
                resolvedId = existing.id;
                await db.update(users).set({
                    name: existing.name ?? name ?? null,
                    image: image ?? existing.image,
                    googleName: name ?? existing.googleName,
                    emailVerified: existing.emailVerified ?? (markEmailVerified ? new Date() : null),
                }).where(eq(users.id, resolvedId));
            } else {
                await db.insert(users).values({
                    id: resolvedId,
                    email,
                    name: name ?? null,
                    image: image ?? null,
                    googleName: name ?? null,
                    emailVerified: markEmailVerified ? new Date() : null,
                });
            }
            await db.insert(userProfiles).values({ userId: resolvedId }).onConflictDoNothing();
            await db.update(userProfiles).set({ lastActiveAt: new Date() }).where(eq(userProfiles.userId, resolvedId));
        } catch (e) {
            logger.error('[Audit] Local user profile upsert failed', e, { userId, email });
        }
    };

    const doUpsert = async () => {
        let d1: D1Database | null = null;
        try {
            const { env } = getRequestContext();
            if (env?.DB) d1 = env.DB;
        } catch { /* not in Cloudflare context */ }
        if (!d1) {
            await doUpsertLocal();
            return;
        }
        try {
            // Resolve the canonical user ID by looking up email first
            let resolvedId = userId;

            if (email) {
                const existing = await d1.prepare(
                    `SELECT id FROM user WHERE email = ? LIMIT 1`
                ).bind(email).first<{ id: string }>();

                if (existing) {
                    // User exists — reuse their original id, refresh avatar
                    // and Google-side name, conditionally backfill display
                    // name. Three columns, three different update policies:
                    //   - name (display): COALESCE(name, ?) — keep the
                    //     current value if non-NULL, only fall back to
                    //     Google's if we don't have one yet. Respects the
                    //     user's custom display name saved via /settings
                    //     (updateUserName at actions/settings.ts:273).
                    //     Pre-v2.18.5, every sign-in clobbered the custom
                    //     name back to whatever Google reported.
                    //   - image: COALESCE(?, image) — use Google's if it
                    //     sent one, else keep current. Avatars are expected
                    //     to refresh as the user's Google picture changes;
                    //     no user-facing override UI exists.
                    //   - google_name: COALESCE(?, google_name) — same as
                    //     image. Always refresh from Google's current
                    //     value so the admin oversight UI can compare
                    //     display name against current Google account
                    //     name. v2.18.6.
                    // Same "respect override, only fill empty" pattern is
                    // already in use below for geo fields (province / city /
                    // timezone) at the user_profiles UPDATE.
                    resolvedId = existing.id;
                    await d1.prepare(
                        `UPDATE user SET name = COALESCE(name, ?), image = COALESCE(?, image), google_name = COALESCE(?, google_name), emailVerified = COALESCE(emailVerified, ?) WHERE id = ?`
                    ).bind(name || null, image || null, name || null, markEmailVerified ? Date.now() : null, resolvedId).run();
                } else {
                    // First time — insert new row. Both `name` (display) and
                    // `google_name` (oauth) start equal to Google's value;
                    // they diverge later if the user customizes via /settings.
                    await d1.prepare(
                        `INSERT INTO user (id, email, name, image, google_name, emailVerified) VALUES (?, ?, ?, ?, ?, ?)`
                    ).bind(resolvedId, email, name || null, image || null, name || null, markEmailVerified ? Date.now() : null).run();
                }
            } else {
                // No email (shouldn't happen with Google) — fallback to INSERT OR IGNORE by id
                await d1.prepare(
                    `INSERT OR IGNORE INTO user (id, email, name, image, google_name) VALUES (?, ?, ?, ?, ?)`
                ).bind(resolvedId, email || null, name || null, image || null, name || null).run();
            }

            // 2. Ensure user_profiles row (INSERT OR IGNORE keeps original created_at)
            //    On first sign-in, also store detected geo data
            await d1.prepare(
                `INSERT OR IGNORE INTO user_profiles (user_id, country, province, province_code, city, timezone, created_at) VALUES (?, ?, ?, ?, ?, ?, strftime('%s','now'))`
            ).bind(resolvedId, detectedCountry, detectedProvince, detectedProvinceCode, detectedCity, detectedTimezone).run();

            // Always update last_active_at, and backfill geo columns if still NULL
            // (respects user overrides — only fills empty slots).
            //
            // v2.19.4: `country` joined the COALESCE backfill set. Before this
            // fix it was set ONCE on the INSERT above and never re-attempted,
            // so any user whose first sign-in landed without a CF-IPCountry
            // header (some edges, VPN, headless test envs) had country=NULL
            // permanently — which then cascaded into every adopter they
            // subsequently created being filtered out of the discovery search.
            // Symmetric with the other geo fields; COALESCE protects user
            // overrides set via /settings (no UI today but the column is
            // ready). One real-world repro: mirella.hualde@gmail.com in
            // prod, signed in once Feb 9 2026 with no CF header, stuck null
            // through six subsequent sign-ins.
            await d1.prepare(
                `UPDATE user_profiles SET
                    last_active_at = strftime('%s','now'),
                    country = COALESCE(country, ?),
                    province = COALESCE(province, ?),
                    province_code = COALESCE(province_code, ?),
                    city = COALESCE(city, ?),
                    timezone = COALESCE(timezone, ?)
                 WHERE user_id = ?`
            ).bind(detectedCountry, detectedProvince, detectedProvinceCode, detectedCity, detectedTimezone, resolvedId).run();

            // 3. v2.14.10: assign a shareable handle for the public showcase URL
            //    (`/user/[handle]`). Only set if currently NULL — stable thereafter
            //    so the URL stays bookmarkable. Generated from the display name
            //    (or email local-part if name absent) via generateUniqueSlug with
            //    integer-suffix-on-collision logic.
            try {
                const profile = await d1.prepare(
                    `SELECT handle FROM user_profiles WHERE user_id = ?`
                ).bind(resolvedId).first<{ handle: string | null }>();
                if (profile && !profile.handle) {
                    const { generateUniqueSlug } = await import('@/lib/slugify');
                    const rawName = name || (email ? email.split('@')[0] : '') || 'rescuer';
                    const handle = await generateUniqueSlug(rawName, async (candidate) => {
                        const taken = await d1.prepare(
                            `SELECT user_id FROM user_profiles WHERE handle = ? LIMIT 1`
                        ).bind(candidate).first<{ user_id: string }>();
                        return taken != null;
                    });
                    await d1.prepare(
                        `UPDATE user_profiles SET handle = ? WHERE user_id = ? AND handle IS NULL`
                    ).bind(handle, resolvedId).run();
                }
            } catch (handleErr) {
                // Non-fatal — handle assignment is opportunistic. If this user
                // signs in again it'll retry. Log so the slugify path is observable.
                logger.warn('[Audit] handle assignment skipped', {
                    userId: resolvedId,
                    error: handleErr instanceof Error ? handleErr.message : String(handleErr),
                });
            }
        } catch (e) {
            logger.error('[Audit] Failed to upsert user profile', e, { userId, email });
        }
    };

    try {
        const { ctx } = getRequestContext();
        if (ctx?.waitUntil) {
            ctx.waitUntil(doUpsert());
        } else {
            doUpsert();
        }
    } catch {
        doUpsert();
    }
}
