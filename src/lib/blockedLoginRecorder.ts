/**
 * Side-effects writer for a blocked adopter-login attempt.
 *
 * Called from the NextAuth signIn callback after `checkAdopterLoginGate`
 * returns `blocked=true`. Writes three things, all best-effort:
 *
 *   1. A row in `blocked_logins` — the immutable audit trail for the
 *      /admin/blocked-logins page.
 *   2. One in-app notification per admin (bootstrap list + DB role=admin)
 *      so they see the alert in the NotificationBell. It goes through
 *      createNotification like every other notice: a template rendered in the
 *      reader's language and the NOTIF_ENABLED_adopter_login_blocked kill
 *      switch. It is never emailed (admin-only, src/domain/noticeRows.ts).
 *   3. An `info`-level log event for Axiom (surfaces in /admin metrics).
 *
 * Best-effort means: each side-effect catches its own error so a partial
 * failure (e.g. notifications insert fails but blocked_logins succeeds)
 * still leaves a useful trail. The auth callback rejects the session
 * regardless of whether this function fully succeeds — the security
 * outcome (user can't sign in) doesn't depend on the bookkeeping.
 */

import { blockedLogins, userProfiles, users } from '@/db/schema';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { BOOTSTRAP_ADMIN_EMAILS } from '@/config/admins';
import type { GateResult } from '@/lib/adopterLoginGate';
import { notificationContent } from '@/domain/notificationTemplates';
import { eq } from 'drizzle-orm';

export async function recordBlockedLogin(email: string, gate: GateResult): Promise<void> {
    const matchedIds = gate.matches.map(m => m.adopterId);
    const summary = gate.matches.map(m => ({
        id: m.adopterId,
        name: m.adopterName,
        avgRating: m.avgRating,
        addedBy: m.addedBy,
        lastChangedBy: m.lastChangedBy,
        triggers: m.triggers,
    }));

    logger.info('adopter-login gate: blocked sign-in', {
        email,
        reason: gate.reason,
        matchCount: matchedIds.length,
    });

    const db = await getDb();
    if (!db) {
        // No DB → can't write the audit row or notifications. The Axiom log
        // above still captures the event. Callers don't depend on this
        // function's return value, so silent return is fine.
        return;
    }

    // 1. Audit row.
    await db.insert(blockedLogins).values({
        id: crypto.randomUUID(),
        email,
        matchedAdopterIds: JSON.stringify(matchedIds),
        reason: gate.reason,
        matchedSummary: JSON.stringify(summary),
    }).catch((e: unknown) => {
        logger.warn('blocked_logins insert failed', { email, error: e instanceof Error ? e.message : String(e) });
    });

    // 2. Notifications for admins. Bootstrap list is the deployment-time
    //    guaranteed-admin set; DB-role admins are added if accessible.
    let dbAdmins: string[] = [];
    try {
        const rows: Array<{ email: string | null }> = await db.select({ email: users.email })
            .from(userProfiles).innerJoin(users, eq(users.id, userProfiles.userId))
            .where(eq(userProfiles.role, 'admin'));
        dbAdmins = rows.map(r => r.email).filter((e): e is string => typeof e === 'string' && e.length > 0);
    } catch (e) {
        logger.warn('blocked-login notification: DB admins lookup failed, bootstrap admins only', {
            email, error: e instanceof Error ? e.message : String(e),
        });
    }

    const adminEmails = Array.from(new Set<string>([...BOOTSTRAP_ADMIN_EMAILS, ...dbAdmins]));
    const primaryMatch = gate.matches.find(m => m.triggers.length > 0) || gate.matches[0];
    const profileUrl = primaryMatch ? `/adopter/${primaryMatch.adopterId}` : '/admin/blocked-logins';
    const matchName = primaryMatch ? (primaryMatch.adopterName || primaryMatch.adopterId) : undefined;

    try {
        const { createNotification } = await import('@/app/actions/notifications');
        const content = notificationContent({
            key: 'adopter_login_blocked',
            params: { email, reason: gate.reason, ...(matchName ? { matchName } : {}) },
        });
        // One row per admin so each gets their own read-state (one insert each — D1: no IN (array)).
        // createNotification logs its own failure and never throws.
        await Promise.all(adminEmails.map(adminEmail => createNotification({
            userId: adminEmail,
            type: 'adopter_login_blocked',
            ...content,
            url: profileUrl,
            icon: '🚫',
            metadata: { email, matchedAdopterIds: matchedIds, reason: gate.reason },
        })));
    } catch (e) {
        logger.warn('blocked-login notification failed', {
            email, adminCount: adminEmails.length, error: e instanceof Error ? e.message : String(e),
        });
    }
}
