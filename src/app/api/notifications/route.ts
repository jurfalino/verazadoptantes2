export const runtime = 'edge';

import { NextResponse } from 'next/server';
import { getUser } from '@/app/actions/_db';
import {
    getNotifications, getUnreadCount, markNotificationRead, markAllNotificationsRead,
    getNotificationsPaginated, getNotificationTypes, dismissNotification, dismissAllNotifications
} from '@/app/actions/notifications';

/**
 * GET /api/notifications
 * Returns notifications + unread count for the authenticated user.
 * Query params:
 *   ?countOnly=true — just the badge count
 *   ?page=1&filter=all&type=contract_result — paginated view for the full page
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

    // Paginated mode (for the full notifications page)
    const page = url.searchParams.get('page');
    if (page) {
        const filter = (url.searchParams.get('filter') || 'all') as 'all' | 'unread' | 'archived';
        const type = url.searchParams.get('type') || undefined;

        const result = await getNotificationsPaginated(user, { page: parseInt(page, 10), filter, type });
        const types = await getNotificationTypes(user);
        const unreadCount = await getUnreadCount(user);

        return NextResponse.json({ ...result, types, unreadCount });
    }

    // Default: bell dropdown (latest 20, no dismissed)
    const items = await getNotifications(user);
    const unreadCount = await getUnreadCount(user);

    return NextResponse.json({ items, unreadCount });
}

/**
 * PATCH /api/notifications
 * Mark one or all notifications as read, or dismiss.
 * Body: { id: string } | { markAllRead: true } | { dismiss: string } | { dismissAll: true }
 */
export async function PATCH(request: Request) {
    const user = await getUser();
    if (!user || user === 'anonymous') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json() as {
        id?: string;
        markAllRead?: boolean;
        dismiss?: string;
        dismissAll?: boolean;
    };

    if (body.markAllRead) {
        await markAllNotificationsRead(user);
        return NextResponse.json({ success: true });
    }

    if (body.dismissAll) {
        await dismissAllNotifications(user);
        return NextResponse.json({ success: true });
    }

    if (body.dismiss) {
        await dismissNotification(body.dismiss, user);
        return NextResponse.json({ success: true });
    }

    if (body.id) {
        await markNotificationRead(body.id, user);
        return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Missing action' }, { status: 400 });
}
