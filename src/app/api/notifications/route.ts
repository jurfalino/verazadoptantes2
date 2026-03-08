export const runtime = 'edge';

import { NextResponse } from 'next/server';
import { getUser } from '@/app/actions/_db';
import { getNotifications, getUnreadCount, markNotificationRead, markAllNotificationsRead } from '@/app/actions/notifications';

/**
 * GET /api/notifications
 * Returns notifications + unread count for the authenticated user.
 * Query param: ?countOnly=true for just the badge count.
 */
export async function GET(request: Request) {
    const user = await getUser();
    if (!user || user === 'anonymous') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const countOnly = url.searchParams.get('countOnly') === 'true';

    if (countOnly) {
        const count = await getUnreadCount(user);
        return NextResponse.json({ unreadCount: count });
    }

    const [items, unreadCount] = await Promise.all([
        getNotifications(user),
        getUnreadCount(user),
    ]);

    return NextResponse.json({ items, unreadCount });
}

/**
 * PATCH /api/notifications
 * Mark one or all notifications as read.
 * Body: { id: string } or { markAllRead: true }
 */
export async function PATCH(request: Request) {
    const user = await getUser();
    if (!user || user === 'anonymous') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json() as { id?: string; markAllRead?: boolean };

    if (body.markAllRead) {
        await markAllNotificationsRead(user);
        return NextResponse.json({ success: true });
    }

    if (body.id) {
        await markNotificationRead(body.id, user);
        return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Missing id or markAllRead' }, { status: 400 });
}
