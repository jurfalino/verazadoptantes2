/**
 * Audit Logger — fire-and-forget audit trail for D1
 * 
 * Uses waitUntil to avoid blocking request handling.
 * Falls back to fire-and-forget if no request context.
 */

import { getRequestContext } from '@cloudflare/next-on-pages';
import { headers } from 'next/headers';

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
export function logAudit(entry: AuditEntry) {
    const doInsert = async () => {
        try {
            const { env } = getRequestContext();
            if (!env?.DB) return;

            // Auto-capture IP and User-Agent from request headers if not provided
            let resolvedIp = entry.ipAddress || null;
            let resolvedDevice = entry.device || null;
            try {
                const h = await headers();
                if (!resolvedIp) {
                    resolvedIp = h.get('cf-connecting-ip') || h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || null;
                }
                if (!resolvedDevice) {
                    resolvedDevice = h.get('user-agent') || null;
                }
            } catch {
                // headers() unavailable outside server request context — skip
            }

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
            // Never let audit logging break the main flow
            console.error('[Audit] Failed to log:', e);
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
 */
export function ensureUserProfile(userId: string, email?: string, name?: string, image?: string) {
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
                    // User exists — reuse their original id, update name/image
                    resolvedId = existing.id;
                    await env.DB.prepare(
                        `UPDATE user SET name = COALESCE(?, name), image = COALESCE(?, image) WHERE id = ?`
                    ).bind(name || null, image || null, resolvedId).run();
                } else {
                    // First time — insert new row
                    await env.DB.prepare(
                        `INSERT INTO user (id, email, name, image) VALUES (?, ?, ?, ?)`
                    ).bind(resolvedId, email, name || null, image || null).run();
                }
            } else {
                // No email (shouldn't happen with Google) — fallback to INSERT OR IGNORE by id
                await env.DB.prepare(
                    `INSERT OR IGNORE INTO user (id, email, name, image) VALUES (?, ?, ?, ?)`
                ).bind(resolvedId, email || null, name || null, image || null).run();
            }

            // 2. Ensure user_profiles row (INSERT OR IGNORE keeps original created_at)
            await env.DB.prepare(
                `INSERT OR IGNORE INTO user_profiles (user_id, created_at) VALUES (?, strftime('%s','now'))`
            ).bind(resolvedId).run();

            // Always update last_active_at
            await env.DB.prepare(
                `UPDATE user_profiles SET last_active_at = strftime('%s','now') WHERE user_id = ?`
            ).bind(resolvedId).run();
        } catch (e) {
            console.error('[Audit] Failed to upsert user profile:', e);
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
