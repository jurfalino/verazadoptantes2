/**
 * NOT a `'use server'` module, deliberately.
 *
 * Every export of a server-action module is a POST endpoint the browser can
 * call with arguments of its choosing. `createNotification` takes the
 * recipient, title, body and click-through URL and checks none of them, so as
 * an action it let any visitor drop a message of their choosing into anyone's
 * notification bell, wearing the product's own chrome. `resolveDisplayNames`
 * answered "what is this person's real name?" for any address.
 *
 * An auth check was the wrong fix: the legitimate callers include the public
 * contract and form submission routes, which have no session on purpose. Taking
 * the module off the wire keeps those working and removes the door entirely.
 * Every caller is server-side (actions, API routes, `src/lib`); the browser
 * reaches notifications through `/api/notifications`, which resolves the
 * session itself and passes the user down.
 *
 * Guarded by `src/lib/serverActionSurface.test.ts` — including against a
 * re-export from a module that IS `'use server'`.
 */

import { getDb } from '@/lib/db';
import { appConfig, notifications } from '@/db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { displayNameFor } from '@/lib/userDisplay';
import { runAfterResponse } from '@/lib/background';
import { sendNotificationEmail } from '@/lib/notificationEmail';
import { renderNotification, type NotificationTemplate } from '@/domain/notificationTemplates';
import type { NotificationType } from '@/domain/constants';
import { notificationKillSwitchKey, notificationTypeEnabled } from '@/domain/notificationKillSwitch';
import { teamCopyDelivery, type AnimalsScope, type TeamCopyDelivery } from '@/domain/animalNotices';

/**
 * Create a notification for a user.
 * This is the single entry point for all notification creation — 
 * the email twin (and future Web Push) hooks go here.
 *
 * `template` (D38) is stored in `metadata.template` so the bell and the email
 * render the text in the reader's language; the row's title/body are its
 * Spanish render (callers build all three with `notificationContent`). A
 * template that does not render keeps the passed title/body and logs a warn.
 */
export async function createNotification(data: {
    id?: string;
    userId: string;
    type?: NotificationType;
    title: string;
    body: string;
    url?: string;
    icon?: string;
    metadata?: Record<string, unknown>;
    template?: NotificationTemplate;
    /**
     * With a caller-chosen `id`: a row with that id already there is not an
     * error — nothing is written or emailed and null is returned (a concurrent
     * sender created it first; src/lib/profileAdditionNotices.ts merges into it).
     */
    ifAbsent?: boolean;
    /** This copy stays in the bell, never emailed (a team copy, the admins' copy of a report). */
    bellOnly?: boolean;
}): Promise<string | null> {
    try {
        const db = await getDb();
        if (!db) {
            logger.warn('createNotification: DB not available');
            return null;
        }

        const type = data.type || 'contract_result';

        // The per-type kill switch (/admin/notifications): no row = on, only 'false' turns it off.
        // A failed read fails open, logged.
        try {
            const row = await db.select({ value: appConfig.value }).from(appConfig)
                .where(eq(appConfig.key, notificationKillSwitchKey(type))).get() as { value: string | null } | undefined;
            if (!notificationTypeEnabled(row?.value)) {
                logger.info('Notification suppressed by admin config', { type, userId: data.userId });
                return null;
            }
        } catch (e) {
            logger.warn('createNotification: kill switch unreadable, sending', { type, userId: data.userId, error: e instanceof Error ? e.message : String(e) });
        }

        const id = data.id || crypto.randomUUID();
        let { title, body } = data;
        if (data.template) {
            const es = renderNotification(data.template, 'es');
            if (es) ({ title, body } = es);
            else logger.warn('createNotification: template did not render, stored text kept', { id, type, key: data.template.key });
        }
        const metadata = data.template ? { ...data.metadata, template: data.template } : data.metadata;
        const values = {
            id,
            userId: data.userId,
            type,
            title,
            body,
            url: data.url || null,
            icon: data.icon || '📋',
            metadata: metadata ? JSON.stringify(metadata) : null,
            createdAt: new Date(),
        };
        if (data.ifAbsent) {
            const won = await db.insert(notifications).values(values).onConflictDoNothing({ target: notifications.id }).returning({ id: notifications.id });
            if (!won.length) {
                logger.info('createNotification: already there (ifAbsent), skipped', { id, type });
                return null;
            }
        } else {
            await db.insert(notifications).values(values);
        }

        logger.info('Notification created', { id, userId: data.userId, type });

        // Email twin («Avisos» rows apply). Never affects the bell's result.
        await runAfterResponse('notification.email', () => sendNotificationEmail({
            id, userId: data.userId, type, title, body, url: data.url ?? null, metadata: metadata ?? null, bellOnly: data.bellOnly,
        }), { type, notificationId: id });

        return id;
    } catch (error) {
        logger.error('Failed to create notification', error, { userId: data.userId });
        return null;
    }
}

/**
 * Get unread notification count for a user.
 * Lightweight query for the bell badge.
 */
export async function getUnreadCount(userId: string): Promise<number> {
    try {
        const db = await getDb();
        if (!db) return 0;

        const result = await db
            .select({ count: sql<number>`count(*)` })
            .from(notifications)
            .where(and(eq(notifications.userId, userId), eq(notifications.read, 0)))
            .get();

        return result?.count || 0;
    } catch (error) {
        logger.error('Failed to get unread count', error, { userId });
        return 0;
    }
}

/**
 * Get notifications for a user (most recent first, limit 20).
 * Excludes dismissed notifications — used by the bell dropdown.
 */
export async function getNotifications(userId: string) {
    try {
        const db = await getDb();
        if (!db) return [];

        return await db
            .select()
            .from(notifications)
            .where(and(
                eq(notifications.userId, userId),
                eq(notifications.dismissed, 0)
            ))
            .orderBy(desc(notifications.createdAt))
            .limit(20)
            .all();
    } catch (error) {
        logger.error('Failed to get notifications', error, { userId });
        return [];
    }
}

/**
 * Mark a single notification as read.
 */
export async function markNotificationRead(id: string, userId: string): Promise<boolean> {
    try {
        const db = await getDb();
        if (!db) return false;

        await db.update(notifications)
            .set({ read: 1 })
            .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));

        return true;
    } catch (error) {
        logger.error('Failed to mark notification read', error, { id, userId });
        return false;
    }
}

/**
 * Mark all notifications as read for a user.
 */
export async function markAllNotificationsRead(userId: string): Promise<boolean> {
    try {
        const db = await getDb();
        if (!db) return false;

        await db.update(notifications)
            .set({ read: 1 })
            .where(and(eq(notifications.userId, userId), eq(notifications.read, 0)));

        return true;
    } catch (error) {
        logger.error('Failed to mark all notifications read', error, { userId });
        return false;
    }
}

const PAGE_SIZE = 20;

/**
 * Get paginated notifications for the full notifications page.
 * filter: 'all' | 'unread' | 'archived'
 * type: optional notification type filter
 */
export async function getNotificationsPaginated(userId: string, opts: {
    page?: number;
    filter?: 'all' | 'unread' | 'archived';
    type?: string;
} = {}): Promise<{ items: any[]; total: number; hasMore: boolean }> {
    try {
        const db = await getDb();
        if (!db) return { items: [], total: 0, hasMore: false };

        const page = Math.max(1, opts.page || 1);
        const filter = opts.filter || 'all';
        const offset = (page - 1) * PAGE_SIZE;

        // Build WHERE conditions
        const conditions = [eq(notifications.userId, userId)];

        if (filter === 'unread') {
            conditions.push(eq(notifications.read, 0));
            conditions.push(eq(notifications.dismissed, 0));
        } else if (filter === 'archived') {
            conditions.push(eq(notifications.dismissed, 1));
        } else {
            // 'all' shows non-dismissed
            conditions.push(eq(notifications.dismissed, 0));
        }

        if (opts.type) {
            conditions.push(eq(notifications.type, opts.type));
        }

        const where = and(...conditions);

        const [items, countResult] = await Promise.all([
            db.select()
                .from(notifications)
                .where(where)
                .orderBy(desc(notifications.createdAt))
                .limit(PAGE_SIZE)
                .offset(offset)
                .all(),
            db.select({ count: sql<number>`count(*)` })
                .from(notifications)
                .where(where)
                .get(),
        ]);

        const total = countResult?.count || 0;

        return {
            items,
            total,
            hasMore: offset + PAGE_SIZE < total,
        };
    } catch (error) {
        logger.error('Failed to get paginated notifications', error, { userId });
        return { items: [], total: 0, hasMore: false };
    }
}

/**
 * Get distinct notification types for a user (for filter pills).
 */
export async function getNotificationTypes(userId: string): Promise<string[]> {
    try {
        const db = await getDb();
        if (!db) return [];

        const rows = await db
            .selectDistinct({ type: notifications.type })
            .from(notifications)
            .where(eq(notifications.userId, userId))
            .all();

        return rows.map((r: { type: string }) => r.type);
    } catch (error) {
        logger.error('Failed to get notification types', error, { userId });
        return [];
    }
}

/**
 * Dismiss (archive) a single notification.
 */
export async function dismissNotification(id: string, userId: string): Promise<boolean> {
    try {
        const db = await getDb();
        if (!db) return false;

        await db.update(notifications)
            .set({ dismissed: 1 })
            .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));

        return true;
    } catch (error) {
        logger.error('Failed to dismiss notification', error, { id, userId });
        return false;
    }
}

/**
 * Dismiss all read notifications for a user.
 */
export async function dismissAllNotifications(userId: string): Promise<boolean> {
    try {
        const db = await getDb();
        if (!db) return false;

        await db.update(notifications)
            .set({ dismissed: 1 })
            .where(and(
                eq(notifications.userId, userId),
                eq(notifications.read, 1),
                eq(notifications.dismissed, 0)
            ));

        return true;
    } catch (error) {
        logger.error('Failed to dismiss all notifications', error, { userId });
        return false;
    }
}

// ── Fan-out Helpers ──────────────────────────────────────────────

/**
 * Resolve a display name for an email from the `user` table: the account name,
 * else the email handle (displayNameFor — the same rule as resolveUserNames, so
 * one person is named one way in every notice; audit C2).
 */
export async function resolveDisplayName(email: string): Promise<string> {
    const key = email.toLowerCase().trim();
    return (await resolveDisplayNames([email])).get(key) ?? displayNameFor(email, null);
}

/**
 * v2.19.45: batched form of `resolveDisplayName`. One D1 subrequest instead
 * of N when the caller has multiple emails — critical on hot paths like
 * `getAdopterPiiContext` where a privileged viewer with many grantees and
 * org-mates was racking up 30-50 subrequests just for name resolution.
 *
 * Returns a `Map<emailLower, displayName>` with the email-handle fallback
 * baked in for any address that didn't have a `user` row (or whose name
 * carries an email), so callers can always read out a non-empty string.
 * Empty input → empty map.
 *
 * Reads through the canonical getDb() (audit C2: the raw request-context
 * binding could read a different database than every other name lookup in
 * dev). `inArray()` is broken on D1 (see `docs/D1_COMPATIBILITY.md`): the
 * `IN (?, ?, …)` is built with one bind per email, ≤90 per statement (D1 caps
 * a statement at 100 bound parameters).
 */
export async function resolveDisplayNames(emails: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const lower = [...new Set(emails.map(e => e.toLowerCase().trim()).filter(Boolean))];
    if (lower.length === 0) return out;
    for (const e of lower) out.set(e, displayNameFor(e, null));
    try {
        const db = await getDb();
        if (db) {
            const { users } = await import('@/db/schema');
            const CHUNK = 90;
            for (let i = 0; i < lower.length; i += CHUNK) {
                const chunk = lower.slice(i, i + CHUNK);
                const rows = await db.select({ email: users.email, name: users.name }).from(users)
                    .where(sql`lower(${users.email}) IN (${sql.join(chunk.map(e => sql`${e}`), sql`, `)})`);
                for (const r of rows) {
                    if (r.email) out.set(r.email.toLowerCase(), displayNameFor(r.email, r.name));
                }
            }
        }
    } catch (e) {
        logger.warn('resolveDisplayNames: batch DB lookup failed', {
            count: lower.length,
            error: e instanceof Error ? e.message : String(e),
        });
    }
    return out;
}

/**
 * Notify all admin users (bootstrap admins + role='admin' in user_profiles).
 * Excludes the actor who triggered the event.
 */
export async function notifyAdmins(opts: {
    actorEmail: string;
    type: NotificationType;
    title: string;
    body: string;
    url?: string;
    icon?: string;
    metadata?: Record<string, unknown>;
    template?: NotificationTemplate;
    /** People already told some other way (e.g. as an owner of a flagged profile): never sent this one. Normalized here. */
    skip?: readonly string[];
    /** The admins' copy stays in the bell (an admin-queue copy of a user-facing type). */
    bellOnly?: boolean;
}): Promise<void> {
    try {
        const adminEmails = new Set<string>();

        // Import bootstrap admin list from single source of truth
        const { BOOTSTRAP_ADMIN_EMAILS } = await import('@/config/admins');
        for (const email of BOOTSTRAP_ADMIN_EMAILS) {
            adminEmails.add(email);
        }

        // DB-based admins via raw D1 query (user_profiles is not in Drizzle schema)
        try {
            const { getRequestContext } = await import('@/lib/requestContext');
            const { env } = getRequestContext();
            if (env?.DB) {
                const rows = await env.DB.prepare(
                    `SELECT u.email FROM user_profiles up
                     INNER JOIN user u ON u.id = up.user_id
                     WHERE up.role = 'admin'`
                ).all<{ email: string }>();
                for (const row of rows.results || []) {
                    adminEmails.add(row.email);
                }
            }
        } catch (e) {
            logger.warn('notifyAdmins: failed to fetch DB admins, falling back to bootstrap list', {
                actorEmail: opts.actorEmail,
                type: opts.type,
                error: e instanceof Error ? e.message : String(e),
            });
        }

        // Exclude the actor, and anyone told some other way.
        adminEmails.delete(opts.actorEmail);
        if (opts.skip?.length) {
            const skip = new Set(opts.skip.map(e => e.trim().toLowerCase()));
            for (const email of [...adminEmails]) if (skip.has(email.trim().toLowerCase())) adminEmails.delete(email);
        }

        if (adminEmails.size === 0) return;

        await Promise.all([...adminEmails].map(email =>
            createNotification({
                userId: email,
                type: opts.type,
                title: opts.title,
                body: opts.body,
                url: opts.url,
                icon: opts.icon,
                metadata: opts.metadata,
                bellOnly: opts.bellOnly,
                template: opts.template,
            })
        ));

        logger.info('Admin notifications sent', { type: opts.type, count: adminEmails.size });
    } catch (error) {
        logger.warn('notifyAdmins failed (non-critical)', { error: error instanceof Error ? error.message : String(error) });
    }
}

/**
 * Notify all org members of the actor's organizations, excluding the actor.
 * Uses getOrgMemberEmailsFor() — session-free, safe for public API routes.
 * With `orgId`, only that organization's members (getMemberEmailsOfOrg): an
 * event about one group (member_joined) never reaches the actor's other groups.
 * With `teamCopy` (forms and contracts, «Avisos» 2026-11-11): every copy is bell
 * only except the one to `teamCopy.emailTo`, and a member who chose «Mis
 * animales» gets no copy unless they added the animal (src/domain/animalNotices.ts).
 * A choice that can't be read counts as the whole team (an extra notice, never
 * a missed one), logged.
 */
export async function notifyOrgMembers(opts: {
    actorEmail: string;
    /** Only this organization's members, not every group the actor is in. */
    orgId?: string;
    type: NotificationType;
    title: string;
    body: string;
    url?: string;
    icon?: string;
    metadata?: Record<string, unknown>;
    template?: NotificationTemplate;
    /** A team copy of a form or contract: only the copy to `emailTo` may be emailed; `animalOwner` null = no animal of the team. */
    teamCopy?: { emailTo: string | null; animalOwner: string | null };
    /** Members who already got their own copy from the caller (compared case-insensitively). */
    excludeEmails?: readonly string[];
}): Promise<void> {
    try {
        const { getOrgMemberEmailsFor, getMemberEmailsOfOrg } = await import('@/lib/orgMembership');
        const emails = opts.orgId ? await getMemberEmailsOfOrg(opts.orgId) : await getOrgMemberEmailsFor(opts.actorEmail);

        // Exclude the actor, and whoever the caller already notified
        const excluded = new Set((opts.excludeEmails ?? []).map(e => e.trim().toLowerCase()));
        const recipients = emails.filter((e: string) => e !== opts.actorEmail && !excluded.has(e.trim().toLowerCase()));
        if (recipients.length === 0) return;

        // Forms and contracts: each member's «Formularios, contratos y controles de:» choice.
        const delivery = new Map<string, TeamCopyDelivery>();
        if (opts.teamCopy) {
            const teamCopy = opts.teamCopy;
            const { getAnimalsScopeForEmail } = await import('@/lib/animalsScope');
            const db = await getDb();
            await Promise.all(recipients.map(async (email: string) => {
                let scope: AnimalsScope = 'team';
                try {
                    if (!db) throw new Error('Database not available');
                    scope = await getAnimalsScopeForEmail(db, email);
                } catch (e) {
                    logger.warn('notifyOrgMembers: animals scope unreadable, the whole team assumed', { type: opts.type, recipient: email, error: e instanceof Error ? e.message : String(e) });
                }
                delivery.set(email, teamCopyDelivery({ recipient: email, emailTo: teamCopy.emailTo, animalOwner: teamCopy.animalOwner, scope }));
            }));
        }
        const told = recipients.filter((email: string) => delivery.get(email) !== 'skip');
        if (told.length < recipients.length) {
            logger.info('notifyOrgMembers: «Mis animales» members skipped', { type: opts.type, recipients: recipients.length, kept: told.length });
        }

        await Promise.all(told.map((email: string) =>
            createNotification({
                userId: email,
                type: opts.type,
                title: opts.title,
                body: opts.body,
                url: opts.url,
                icon: opts.icon,
                metadata: opts.metadata,
                template: opts.template,
                ...(delivery.get(email) === 'bell' ? { bellOnly: true } : {}),
            })
        ));

        logger.info('Org member notifications sent', { type: opts.type, count: told.length });
    } catch (error) {
        logger.warn('notifyOrgMembers failed (non-critical)', { type: opts.type, orgId: opts.orgId, error: error instanceof Error ? error.message : String(error) });
    }
}


