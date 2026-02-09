/**
 * Audit Logger — fire-and-forget audit trail for D1
 * 
 * Uses waitUntil to avoid blocking request handling.
 * Falls back to fire-and-forget if no request context.
 */

import { getRequestContext } from '@cloudflare/next-on-pages';

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
                entry.device || null,
                entry.isPWA ? 1 : 0,
                entry.ipAddress || null
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
 */
export function ensureUserProfile(userId: string, email?: string, name?: string, image?: string) {
    const doUpsert = async () => {
        try {
            const { env } = getRequestContext();
            if (!env?.DB) return;

            // 1. Ensure NextAuth user row exists (adapter doesn't run on Edge)
            await env.DB.prepare(
                `INSERT OR IGNORE INTO user (id, email, name, image) VALUES (?, ?, ?, ?)`
            ).bind(userId, email || null, name || null, image || null).run();

            // Update name/image if they changed (Google profile updates)
            if (name || image) {
                await env.DB.prepare(
                    `UPDATE user SET name = COALESCE(?, name), image = COALESCE(?, image) WHERE id = ?`
                ).bind(name || null, image || null, userId).run();
            }

            // 2. Ensure user_profiles row (INSERT OR IGNORE keeps original created_at)
            await env.DB.prepare(
                `INSERT OR IGNORE INTO user_profiles (user_id, created_at) VALUES (?, strftime('%s','now'))`
            ).bind(userId).run();

            // Always update last_active_at
            await env.DB.prepare(
                `UPDATE user_profiles SET last_active_at = strftime('%s','now') WHERE user_id = ?`
            ).bind(userId).run();
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
