'use server';

import { getDb } from '@/lib/db';
import { notifications } from '@/db/schema';
import { eq, and, desc, sql, or } from 'drizzle-orm';
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

        const id = data.id || crypto.randomUUID();
        await db.insert(notifications).values({
            id,
            userId: data.userId,
            type: data.type || 'contract_result',
            title: data.title,
            body: data.body,
            url: data.url || null,
            icon: data.icon || '📋',
            metadata: data.metadata ? JSON.stringify(data.metadata) : null,
            createdAt: new Date(),
        });

        logger.info('Notification created', { id, userId: data.userId, type: data.type || 'contract_result' });

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
