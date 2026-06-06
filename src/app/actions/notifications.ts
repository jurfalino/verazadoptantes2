'use server';

import { getDb } from '@/lib/db';
import { notifications } from '@/db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { logger } from '@/lib/logger';

/**
 * Create a notification for a user.
 * This is the single entry point for all notification creation — 
 * future escalation (Web Push, email) hooks go here.
 */
export async function createNotification(data: {
    id?: string;
    userId: string;
    type?: string;
    title: string;
    body: string;
    url?: string;
    icon?: string;
    metadata?: Record<string, unknown>;
}): Promise<string | null> {
    try {
        const db = await getDb();
        if (!db) {
            logger.warn('createNotification: DB not available');
            return null;
        }

        const type = data.type || 'contract_result';

        // Check global kill switch using cached Edge implementation
        try {
            const { getFeatureFlag } = await import('@/config/features');
            // Cast to any to bypass strict type checking for dynamic keys
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const isEnabled = await getFeatureFlag(`NOTIF_ENABLED_${type}` as any) !== false;
            
            if (!isEnabled) {
                logger.info('Notification suppressed by admin config', { type });
                return null;
            }
        } catch {
            // Fail open if config fails to fetch
            logger.warn('Failed to evaluate notification kill switch, defaulting to sending', { type });
        }

        const id = data.id || crypto.randomUUID();
        await db.insert(notifications).values({
            id,
            userId: data.userId,
            type,
            title: data.title,
            body: data.body,
            url: data.url || null,
            icon: data.icon || '📋',
            metadata: data.metadata ? JSON.stringify(data.metadata) : null,
            createdAt: new Date(),
        });

        logger.info('Notification created', { id, userId: data.userId, type });

        // ── Escalation hooks (Phase 2) ──
        // await sendPushNotification(data.userId, { title: data.title, body: data.body, url: data.url });
        // await sendEmailNotification(data.userId, { title: data.title, body: data.body, url: data.url });

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
 * Resolve a display name for an email from the `user` table.
 * Falls back to the email prefix if lookup fails.
 */
export async function resolveDisplayName(email: string): Promise<string> {
    try {
        const { getRequestContext } = await import('@cloudflare/next-on-pages');
        const { env } = getRequestContext();
        if (env?.DB) {
            const row = await env.DB.prepare(
                `SELECT name FROM user WHERE email = ? LIMIT 1`
            ).bind(email).first<{ name: string | null }>();
            if (row?.name) return row.name;
        }
    } catch (e) {
        logger.warn('resolveDisplayName: DB lookup failed', { error: e instanceof Error ? e.message : String(e) });
    }
    return email.split('@')[0];
}

/**
 * Notify all admin users (bootstrap admins + role='admin' in user_profiles).
 * Excludes the actor who triggered the event.
 */
export async function notifyAdmins(opts: {
    actorEmail: string;
    type: string;
    title: string;
    body: string;
    url?: string;
    icon?: string;
    metadata?: Record<string, unknown>;
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
            const { getRequestContext } = await import('@cloudflare/next-on-pages');
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

        // Exclude the actor
        adminEmails.delete(opts.actorEmail);

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
 */
export async function notifyOrgMembers(opts: {
    actorEmail: string;
    type: string;
    title: string;
    body: string;
    url?: string;
    icon?: string;
    metadata?: Record<string, unknown>;
}): Promise<void> {
    try {
        const { getOrgMemberEmailsFor } = await import('@/app/actions/organizations');
        const emails = await getOrgMemberEmailsFor(opts.actorEmail);

        // Exclude the actor
        const recipients = emails.filter((e: string) => e !== opts.actorEmail);
        if (recipients.length === 0) return;

        await Promise.all(recipients.map((email: string) =>
            createNotification({
                userId: email,
                type: opts.type,
                title: opts.title,
                body: opts.body,
                url: opts.url,
                icon: opts.icon,
                metadata: opts.metadata,
            })
        ));

        logger.info('Org member notifications sent', { type: opts.type, count: recipients.length });
    } catch (error) {
        logger.warn('notifyOrgMembers failed (non-critical)', { error: error instanceof Error ? error.message : String(error) });
    }
}

// ── Owner-awareness on org-mate edits (v2.18.11) ────────────────

const NOTIF_BUCKET_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Notify the owner of an adopter when a non-self editor touches their
 * profile (saveAdopter / per-entry edit/remove / saveAdoption / saveImage /
 * setProfilePicture). The action's own gate has already authorised the
 * editor — this helper is the awareness layer.
 *
 * Dedup by deterministic id: within a 30-minute window, the same
 * (owner, adopter, editor) tuple produces ONE notification row. A second
 * call within the window UPDATEs `body` + bumps `createdAt` so the bell
 * surfaces the latest description, instead of inserting a new row that
 * would clutter the panel.
 *
 * Quiet when:
 *   - editor === owner (no self-notify)
 *   - editor is empty / 'anonymous' (no addressable actor)
 *   - owner is empty / 'anonymous' (no addressable recipient)
 *
 * Loud for all other editors: admins, moderators, org-mates, original
 * contributors. The action gate ensures only these reach here.
 */
export async function notifyOwnerOfOrgMateChange(opts: {
    adopterId: string;
    adopterName: string;
    ownerEmail: string | null | undefined;
    editorEmail: string | null | undefined;
    changeKind: 'profile_edit' | 'contact_update' | 'contact_remove' | 'activity_added' | 'image_added' | 'profile_picture_set';
    /** Short, human-readable summary of the change (no PII). Used as the bell body. */
    summary: string;
}): Promise<void> {
    try {
        const owner = (opts.ownerEmail ?? '').toLowerCase().trim();
        const editor = (opts.editorEmail ?? '').toLowerCase().trim();
        if (!owner || owner === 'anonymous') return;
        if (!editor || editor === 'anonymous') return;
        if (owner === editor) return;

        const bucket = Math.floor(Date.now() / NOTIF_BUCKET_MS);
        // Deterministic id collapses repeat fires within the bucket. We
        // never log this id at a level that reaches the bell; it's strictly
        // a stable handle for the upsert.
        const id = `orgmate__${owner}__${opts.adopterId}__${editor}__${bucket}`;

        const editorName = await resolveDisplayName(editor);
        const title = `🛠 ${editorName} editó "${opts.adopterName}"`;
        const url = `/adopter/${opts.adopterId}#history`;

        const db = await getDb();
        if (!db) {
            logger.warn('notifyOwnerOfOrgMateChange: DB unavailable', { adopterId: opts.adopterId });
            return;
        }

        const existing = await db.select({ id: notifications.id, body: notifications.body })
            .from(notifications).where(eq(notifications.id, id)).get();

        if (existing) {
            // Bump createdAt + replace body with the latest summary. We do
            // NOT mark unread again if the user already read it — let them
            // self-trigger another read.
            await db.update(notifications)
                .set({
                    body: opts.summary,
                    createdAt: new Date(),
                })
                .where(eq(notifications.id, id));
            logger.info('notifyOwnerOfOrgMateChange: deduped within bucket', {
                adopterId: opts.adopterId, editor, owner,
            });
            return;
        }

        await createNotification({
            id,
            userId: owner,
            type: 'profile_edited_by_orgmate',
            title,
            body: opts.summary,
            url,
            icon: '🛠',
            metadata: {
                adopterId: opts.adopterId,
                editorEmail: editor,
                changeKind: opts.changeKind,
            },
        });
    } catch (e) {
        // Never let a notification miss break the underlying mutation.
        logger.warn('notifyOwnerOfOrgMateChange failed (non-critical)', {
            adopterId: opts.adopterId,
            error: e instanceof Error ? e.message : String(e),
        });
    }
}

