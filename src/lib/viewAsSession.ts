/**
 * Session side of "view as" (rules in src/domain/viewAs.ts).
 *
 * Runs inside the jwt callback on every session resolution. This is the only
 * trust boundary: any signed-in user can send a session update from the
 * browser, so the start request is re-authorized here, and an active claim is
 * re-checked against the admin's role on every request.
 */

import { eq } from 'drizzle-orm';
import { activeViewAs, decideViewAsStart, parseViewAsRequest, type ViewAsClaim } from '@/domain/viewAs';
import { logger } from '@/lib/logger';

export interface ViewAsTarget {
    id: string;
    email: string;
    name: string | null;
    image: string | null;
}

export interface ViewAsDeps {
    now: () => number;
    isAdmin: (email: string) => Promise<boolean>;
    /** Like isAdmin, but throws when the lookup fails — a target is refused then. */
    isAdminStrict: (email: string) => Promise<boolean>;
    findUser: (id: string) => Promise<ViewAsTarget | null>;
    /** Records start/stop in the audit log; false if the row could not be written. */
    record: (event: { action: 'view_as_start' | 'view_as_stop'; actorEmail: string; actorId: string | null; target: ViewAsTarget | ViewAsClaim }) => Promise<boolean>;
}

type Token = Record<string, unknown> & { email?: string | null; sub?: string; viewAs?: unknown };

/**
 * Applies any start/stop request to `token.viewAs`, drops a claim that is no
 * longer valid, and returns the claim in force (or null).
 */
export async function resolveViewAs(token: Token, trigger: string | undefined, payload: unknown, deps: ViewAsDeps): Promise<ViewAsClaim | null> {
    const actorEmail = typeof token.email === 'string' ? token.email : null;
    const request = trigger === 'update' ? parseViewAsRequest(payload) : { kind: 'none' as const };
    const actorId = typeof token.sub === 'string' ? token.sub : null;
    const now = deps.now();
    // The actor's role is re-checked on every request; a claim started in
    // this one was checked a moment ago.
    let checkedActorNow = false;

    if (request.kind === 'start') {
        const actorIsAdmin = actorEmail ? await deps.isAdmin(actorEmail) : false;
        const target = actorIsAdmin ? await deps.findUser(request.userId) : null;
        // A failed role lookup must not read as "not an admin" here.
        const targetIsAdmin = target ? await deps.isAdminStrict(target.email).catch(() => true) : false;
        const decision = decideViewAsStart({
            actorEmail,
            actorIsAdmin,
            target: target ? { id: target.id, email: target.email, isAdmin: targetIsAdmin } : null,
        });
        if (decision.ok && target && actorEmail) {
            // No audit row, no viewing: an unrecorded session as someone else is what this must never be.
            if (await deps.record({ action: 'view_as_start', actorEmail, actorId, target })) {
                token.viewAs = { userId: target.id, email: target.email, name: target.name, image: target.image, startedAt: now } satisfies ViewAsClaim;
                checkedActorNow = true;
            }
        } else if (!decision.ok) {
            logger.warn('viewAs: start refused', { actorEmail, targetUserId: request.userId, reason: decision.reason });
        }
    } else if (request.kind === 'stop') {
        const claim = activeViewAs(token.viewAs, now);
        if (claim && actorEmail) {
            await deps.record({ action: 'view_as_stop', actorEmail, actorId, target: claim });
        }
        delete token.viewAs;
    }

    if (token.viewAs === undefined) return null;

    const claim = activeViewAs(token.viewAs, now);
    if (!claim) {
        delete token.viewAs;
        return null;
    }
    if (!checkedActorNow && !(actorEmail && await deps.isAdmin(actorEmail))) {
        logger.warn('viewAs: actor is no longer an admin, dropping claim', { actorEmail, targetUserId: claim.userId });
        delete token.viewAs;
        return null;
    }
    return claim;
}

/** Production dependencies: the user table, the admin check and the audit log. */
export async function viewAsDeps(): Promise<ViewAsDeps> {
    const [{ getDb }, { isAdminAsync, isAdminAsyncStrict }, { users, auditLog }] = await Promise.all([
        import('@/lib/db'),
        import('@/config/admins'),
        import('@/db/schema'),
    ]);
    return {
        now: () => Date.now(),
        isAdmin: (email) => isAdminAsync(email),
        isAdminStrict: (email) => isAdminAsyncStrict(email),
        findUser: async (id) => {
            const db = await getDb();
            if (!db) return null;
            const rows = await db
                .select({ id: users.id, email: users.email, name: users.name, image: users.image })
                .from(users)
                .where(eq(users.id, id))
                .limit(1);
            return rows[0] ?? null;
        },
        record: async ({ action, actorEmail, actorId, target }) => {
            // Awaited, not logAudit's waitUntil, and through the guard's one
            // bypass: the request may already be read-only (a stop always is).
            const targetId = 'userId' in target ? target.userId : target.id;
            const row = {
                id: crypto.randomUUID(),
                userId: actorId,
                userEmail: actorEmail,
                action,
                target: targetId,
                details: JSON.stringify({ targetEmail: target.email }),
            };
            try {
                const { unguardedD1ForViewAsAudit } = await import('@/lib/readOnlyGuard');
                const d1 = unguardedD1ForViewAsAudit();
                if (d1) {
                    await d1.prepare(
                        `INSERT INTO audit_log (id, user_id, user_email, action, target, details, created_at)
                         VALUES (?, ?, ?, ?, ?, ?, strftime('%s','now'))`
                    ).bind(row.id, row.userId, row.userEmail, row.action, row.target, row.details).run();
                } else {
                    // No Cloudflare context (local `next start`): the read-write local
                    // file directly — getDb() hands a marked request the read-only one.
                    const { createLocalDb } = await import('@/db/local');
                    const db = await createLocalDb('local.db');
                    if (!db) throw new Error('DB unavailable');
                    await db.insert(auditLog).values(row);
                }
                return true;
            } catch (e) {
                // Never throw from here: a jwt callback that throws signs the admin out.
                logger.error('viewAs: audit insert failed', e, { action, actorEmail, targetUserId: targetId });
                return false;
            }
        },
    };
}
