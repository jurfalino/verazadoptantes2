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
 */
export async function getNotifications(userId: string) {
    try {
        const db = await getDb();
        if (!db) return [];

        return await db
            .select()
            .from(notifications)
            .where(eq(notifications.userId, userId))
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
