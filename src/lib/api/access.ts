/**
 * API access by admin approval (Jon, 2026-10-17). A person asks at /developers
 * (after accepting the terms) — with the tool and what it is for; an admin
 * approves, denies or blocks in Admin → API. Only an approved person (or an
 * admin) creates keys. Blocking revokes every key they hold and refuses new
 * ones, admin-issued included. Its own table, not a user role: a rescuer keeps
 * being a viewer / contributor / admin. Server-only.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { apiAccess, apiKeys } from '@/db/schema';
import { isAdminAsync } from '@/config/admins';
import { logger } from '@/lib/logger';

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

/** May this person create keys? Admins always; otherwise an approved request. */
export async function canCreateKeys(db: Db, email: string): Promise<boolean> {
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
    await db.insert(apiAccess).values({ userEmail: email, status: 'requested', tool: t, purpose: p || null, requestedAt: now })
        .onConflictDoUpdate({ target: apiAccess.userEmail, set: { status: 'requested', tool: t, purpose: p || null, requestedAt: now, decidedAt: null, decidedBy: null, note: null } });
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
    logger.info('api access decided', { email, decision, admin, keysRevoked });
    return { status, keysRevoked };
}

/** Blocked people get no key, whoever issues it. */
export async function isBlocked(db: Db, email: string): Promise<boolean> {
    return (await getAccess(db, email)).status === 'blocked';
}
