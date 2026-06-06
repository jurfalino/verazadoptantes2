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
 */
export async function ensureUserProfile(userId: string, email?: string, name?: string, image?: string) {
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

    const doUpsert = async () => {
        try {
            const { env } = getRequestContext();
            if (!env?.DB) return;


            // Resolve the canonical user ID by looking up email first
            let resolvedId = userId;

            if (email) {
                const existing = await env.DB.prepare(
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
                    await env.DB.prepare(
                        `UPDATE user SET name = COALESCE(name, ?), image = COALESCE(?, image), google_name = COALESCE(?, google_name) WHERE id = ?`
                    ).bind(name || null, image || null, name || null, resolvedId).run();
                } else {
                    // First time — insert new row. Both `name` (display) and
                    // `google_name` (oauth) start equal to Google's value;
                    // they diverge later if the user customizes via /settings.
                    await env.DB.prepare(
                        `INSERT INTO user (id, email, name, image, google_name) VALUES (?, ?, ?, ?, ?)`
                    ).bind(resolvedId, email, name || null, image || null, name || null).run();
                }
            } else {
                // No email (shouldn't happen with Google) — fallback to INSERT OR IGNORE by id
                await env.DB.prepare(
                    `INSERT OR IGNORE INTO user (id, email, name, image, google_name) VALUES (?, ?, ?, ?, ?)`
                ).bind(resolvedId, email || null, name || null, image || null, name || null).run();
            }

            // 2. Ensure user_profiles row (INSERT OR IGNORE keeps original created_at)
            //    On first sign-in, also store detected geo data
            await env.DB.prepare(
                `INSERT OR IGNORE INTO user_profiles (user_id, country, province, province_code, city, timezone, created_at) VALUES (?, ?, ?, ?, ?, ?, strftime('%s','now'))`
            ).bind(resolvedId, detectedCountry, detectedProvince, detectedProvinceCode, detectedCity, detectedTimezone).run();

            // Always update last_active_at, and backfill geo columns if still NULL
            // (respects user overrides — only fills empty slots)
            await env.DB.prepare(
                `UPDATE user_profiles SET
                    last_active_at = strftime('%s','now'),
                    province = COALESCE(province, ?),
                    province_code = COALESCE(province_code, ?),
                    city = COALESCE(city, ?),
                    timezone = COALESCE(timezone, ?)
                 WHERE user_id = ?`
            ).bind(detectedProvince, detectedProvinceCode, detectedCity, detectedTimezone, resolvedId).run();

            // 3. v2.14.10: assign a shareable handle for the public showcase URL
            //    (`/user/[handle]`). Only set if currently NULL — stable thereafter
            //    so the URL stays bookmarkable. Generated from the display name
            //    (or email local-part if name absent) via generateUniqueSlug with
            //    integer-suffix-on-collision logic.
            try {
                const profile = await env.DB.prepare(
                    `SELECT handle FROM user_profiles WHERE user_id = ?`
                ).bind(resolvedId).first<{ handle: string | null }>();
                if (profile && !profile.handle) {
                    const { generateUniqueSlug } = await import('@/lib/slugify');
                    const rawName = name || (email ? email.split('@')[0] : '') || 'rescuer';
                    const handle = await generateUniqueSlug(rawName, async (candidate) => {
                        const taken = await env.DB.prepare(
                            `SELECT user_id FROM user_profiles WHERE handle = ? LIMIT 1`
                        ).bind(candidate).first<{ user_id: string }>();
                        return taken != null;
                    });
                    await env.DB.prepare(
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
