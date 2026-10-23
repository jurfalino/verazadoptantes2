/**
 * API access by admin approval (Jon, 2026-10-17; 2026-10-22). A person creates
 * keys at /developers right after accepting the terms; their first key files
 * the request (tool and what it is for). Until an admin approves, their own
 * keys run at PENDING_APPROVAL_CAPS; approval raises them to the self-service
 * limits, a deny keeps them low. Blocking revokes every key they hold and
 * refuses new ones, admin-issued included. Its own table, not a user role: a rescuer keeps
 * being a viewer / contributor / admin. Server-only.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { apiAccess, apiKeys } from '@/db/schema';
import { isAdminAsync, isAdminAsyncStrict } from '@/config/admins';
import { logger } from '@/lib/logger';
import { maskEmail } from '@/lib/dates';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

export const ACCESS_STATUSES = ['none', 'requested', 'approved', 'denied', 'blocked'] as const;
export type AccessStatus = typeof ACCESS_STATUSES[number];

export interface AccessView {
    status: AccessStatus;
    tool: string | null;
    purpose: string | null;
    requestedAt: string | null;
    decidedAt: string | null;
    decidedBy: string | null;
    note: string | null;
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : typeof v === 'number' ? new Date(v * 1000).toISOString() : null);

export async function getAccess(db: Db, email: string): Promise<AccessView> {
    const row = await db.select().from(apiAccess).where(eq(apiAccess.userEmail, email)).get() as typeof apiAccess.$inferSelect | undefined;
    if (!row) return { status: 'none', tool: null, purpose: null, requestedAt: null, decidedAt: null, decidedBy: null, note: null };
    return {
        status: (ACCESS_STATUSES as readonly string[]).includes(row.status) ? row.status as AccessStatus : 'none',
        tool: row.tool, purpose: row.purpose, requestedAt: iso(row.requestedAt), decidedAt: iso(row.decidedAt), decidedBy: row.decidedBy, note: row.note,
    };
}

/** May this person create keys? Anyone not blocked (Jon, 2026-10-22); until approved, with the pending limits. */
export async function canCreateKeys(db: Db, email: string): Promise<boolean> {
    if (await isAdminAsync(email)) return true;
    return (await getAccess(db, email)).status !== 'blocked';
}

/** Are this person's own keys at the full self-service limits? Admins always; otherwise an approved request. */
export async function hasFullLimits(db: Db, email: string): Promise<boolean> {
    if (await isAdminAsync(email)) return true;
    return (await getAccess(db, email)).status === 'approved';
}

export type RequestResult = { ok: true; status: AccessStatus } | { error: 'tool_required' | 'blocked' | 'already_approved' };

/** Ask for access (again, after a denial). A blocked person can't; an approved one needn't. */
export async function requestAccess(db: Db, email: string, tool: string, purpose: string): Promise<RequestResult> {
    const t = tool.trim().slice(0, 120), p = purpose.trim().slice(0, 1000);
    if (!t) return { error: 'tool_required' };
    const current = await getAccess(db, email);
    if (current.status === 'blocked') return { error: 'blocked' };
    if (current.status === 'approved') return { error: 'already_approved' };
    const now = new Date();
    // Conditional: a block (or approval) decided between the read above and this write must win.
    const written = await db.insert(apiAccess).values({ userEmail: email, status: 'requested', tool: t, purpose: p || null, requestedAt: now })
        .onConflictDoUpdate({
            target: apiAccess.userEmail,
            set: { status: 'requested', tool: t, purpose: p || null, requestedAt: now, decidedAt: null, decidedBy: null, note: null },
            setWhere: sql`${apiAccess.status} NOT IN ('blocked', 'approved')`,
        }).returning({ status: apiAccess.status });
    if (!written.length) {
        const now2 = await getAccess(db, email);
        return { error: now2.status === 'blocked' ? 'blocked' : 'already_approved' };
    }
    return { ok: true, status: 'requested' };
}

export type Decision = 'approve' | 'deny' | 'block' | 'unblock';

/**
 * An admin's decision. `block` revokes every active key the person holds (and
 * keeps refusing new ones); `unblock` leaves them with no access (they ask again).
 */
export async function decideAccess(db: Db, email: string, decision: Decision, admin: string, note: string | null): Promise<{ status: AccessStatus; keysRevoked: number }> {
    const status: AccessStatus = decision === 'approve' ? 'approved' : decision === 'deny' ? 'denied' : decision === 'block' ? 'blocked' : 'none';
    const now = new Date();
    const n = note?.trim().slice(0, 1000) || null;
    if (status === 'none') {
        await db.delete(apiAccess).where(eq(apiAccess.userEmail, email));
    } else {
        await db.insert(apiAccess).values({ userEmail: email, status, decidedAt: now, decidedBy: admin, note: n })
            .onConflictDoUpdate({ target: apiAccess.userEmail, set: { status, decidedAt: now, decidedBy: admin, note: n } });
    }
    let keysRevoked = 0;
    if (status === 'blocked') {
        const revoked = await db.update(apiKeys).set({ revokedAt: now, revokedBy: admin })
            .where(and(eq(apiKeys.ownerEmail, email), isNull(apiKeys.revokedAt))).returning({ id: apiKeys.id });
        keysRevoked = revoked.length;
    }
    logger.info('api access decided', { person: maskEmail(email), decision, admin, keysRevoked });
    return { status, keysRevoked };
}

/** Blocked people get no key, whoever issues it. */
export async function isBlocked(db: Db, email: string): Promise<boolean> {
    return (await getAccess(db, email)).status === 'blocked';
}

/**
 * Daily limits of a key its owner created at /developers while their access is
 * not approved (Jon, 2026-10-22: get a key at once, an admin approval raises the
 * limit). Across all their own keys, not per key. Approved → SELF_SERVICE_CAPS.
 */
export const PENDING_APPROVAL_CAPS = { exact: 25, fuzzy: 10 } as const;

export interface KeyAccess {
    /** A blocked person's keys stop at once (checked on every call). */
    refusal: 'access_blocked' | null;
    /** A self-created key whose owner is not approved (nor an admin): PENDING_APPROVAL_CAPS apply. */
    limited: boolean;
}

/**
 * Checked on EVERY API call, not only when a key is made (review 2026-10-17):
 * a blocked person's keys stop at once, even one created in a race with the
 * block. A key the person made themselves works before approval, with the
 * pending limits (a deny keeps them there). Admin-issued keys answer only to a block.
 */
export async function keyAccess(db: Db, key: { ownerEmail: string; createdBy: string | null }): Promise<KeyAccess> {
    const status = (await getAccess(db, key.ownerEmail)).status;
    if (status === 'blocked') return { refusal: 'access_blocked', limited: false };
    // Strict: a failed admin lookup throws (→ 503) instead of reading as "not admin" (→ wrongly limited).
    const limited = key.createdBy === key.ownerEmail && status !== 'approved' && !(await isAdminAsyncStrict(key.ownerEmail));
    return { refusal: null, limited };
}

/** The key as the limits see it: a limited key's daily caps lowered to the pending ones. Pure. */
export function withPendingCaps<K extends { dailyCapExact: number; dailyCapFuzzy: number }>(key: K): K {
    return { ...key, dailyCapExact: Math.min(key.dailyCapExact, PENDING_APPROVAL_CAPS.exact), dailyCapFuzzy: Math.min(key.dailyCapFuzzy, PENDING_APPROVAL_CAPS.fuzzy) };
}
