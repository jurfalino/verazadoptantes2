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
 * Ensure a user_profiles row exists for the given user.
 * Called on sign-in to track first sign date and last activity.
 */
export function ensureUserProfile(userId: string, email?: string) {
    const doUpsert = async () => {
        try {
            const { env } = getRequestContext();
            if (!env?.DB) return;

            // INSERT OR IGNORE keeps the original created_at (first sign date)
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
