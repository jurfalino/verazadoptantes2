import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isAdminAsync } from '@/config/admins';
import { getDb } from '@/lib/db';
import { appConfig, notifications } from '@/db/schema';
import { like, eq } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';
import { logger } from '@/lib/logger';
import { resolveDisplayNames } from '@/app/actions/notifications';
import { notificationSeenState } from '@/domain/notificationState';

import { getRequestContext } from '@cloudflare/next-on-pages';

export const runtime = 'edge';

/** A row of the per-type preview query below. */
interface PreviewRow { id: string; userId: string; read: number | null; dismissed: number | null; [column: string]: unknown }

export async function GET() {
    // Auth guard
    const session = await auth();
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isAdmin = await isAdminAsync(session.user.email);
    if (!isAdmin) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    try {
        const db = await getDb();
        if (!db) {
            return NextResponse.json({ error: 'Database unavailable' }, { status: 500 });
        }

        const { env } = getRequestContext();
        if (!env?.DB) {
            return NextResponse.json({ error: 'Raw D1 binding unavailable' }, { status: 500 });
        }
        const rawDb = env.DB;

        // 1. Get aggregate stats per notification type
        // Use raw SQLite query for complex aggregation
        const statsQuery = `
            SELECT 
                type, 
                COUNT(*) as totalSent, 
                SUM(CASE WHEN read = 1 THEN 1 ELSE 0 END) as totalRead,
                MAX(created_at) as lastSentAt
            FROM notifications 
            GROUP BY type
            ORDER BY totalSent DESC
        `;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const statsRaw = await rawDb.prepare(statsQuery).all() as any;
        const stats = statsRaw.results || [];

        // 2. Fetch the "kill switch" configuration for these types
        const configs = await db.select()
            .from(appConfig)
            .where(like(appConfig.key, 'NOTIF_ENABLED_%'))
            .all();
        
        const configMap = new Map<string, string>();
        for (const cfg of configs) {
            // Remove 'NOTIF_ENABLED_' prefix (len 14)
            const typeKey = cfg.key.substring(14);
            configMap.set(typeKey, cfg.value);
        }

        // 3. Get all unique types across DB stats, configs, and hardcoded known types
        const knownTypes = ['contract_result', 'form_result', 'duplicate_candidate', 'import_result'];
        const allTypes = new Set<string>([...knownTypes, ...stats.map((s: any) => s.type), ...Array.from(configMap.keys())]);

        // 4. Build payload for every discovered type
        const enrichedStats = await Promise.all(Array.from(allTypes).map(async (type) => {
            const stat = stats.find((s: any) => s.type === type) || { totalSent: 0, totalRead: 0, lastSentAt: null };
            
             
            const previewQuery = await rawDb.prepare(`
                SELECT id, user_id as userId, title, body, url, icon, metadata,
                       created_at as createdAt, read, dismissed
                FROM notifications
                WHERE type = ?
                ORDER BY created_at DESC
                LIMIT 10
            `).bind(type).all() as any;

            // Default state for a type is implicitly 'true' unless strictly 'false' in the DB
            const isEnabled = configMap.get(type) !== 'false';

            return {
                type,
                totalSent: Number(stat.totalSent),
                totalRead: Number(stat.totalRead),
                lastSentAt: stat.lastSentAt,
                isEnabled,
                previews: previewQuery.results || []
            };
        }));

        // Who received each one, by name. Admin-only page, so the email is shown
        // alongside; one batched lookup for every recipient on the page.
        const recipientEmails = [...new Set(enrichedStats.flatMap(s => (s.previews as PreviewRow[]).map(p => p.userId)).filter(Boolean))];
        const names = await resolveDisplayNames(recipientEmails).catch((e) => {
            logger.warn('admin notifications: recipient name lookup failed', { error: e instanceof Error ? e.message : String(e) });
            return new Map<string, string>();
        });
        for (const s of enrichedStats) {
            s.previews = (s.previews as PreviewRow[]).map(p => ({
                ...p,
                // resolveDisplayNames keys its map by lowercased email.
                recipientName: names.get(String(p.userId).toLowerCase()) || null,
                seenState: notificationSeenState(p),
            }));
        }

        // Sort enriched stats by totalSent DESC, then alphabetically
        enrichedStats.sort((a, b) => {
            if (b.totalSent !== a.totalSent) return b.totalSent - a.totalSent;
            return a.type.localeCompare(b.type);
        });

        return NextResponse.json({ types: enrichedStats });
    } catch (error) {
        logger.error('Failed to fetch admin notifications', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

/**
 * Delete one triggered notification (admin only). It disappears from the
 * recipient's bell for good, so it is confirmed in the UI and recorded in the
 * audit log with who it was for — the notification body is NOT copied there, it
 * can name a third party.
 */
export async function DELETE(request: Request) {
    const session = await auth();
    const actor = session?.user?.email;
    if (!actor) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!(await isAdminAsync(actor))) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const id = new URL(request.url).searchParams.get('id')?.trim() || '';
    try {
        if (!id || id.length > 100) {
            return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
        }
        const db = await getDb();
        if (!db) {
            return NextResponse.json({ error: 'Database unavailable' }, { status: 500 });
        }
        const existing = await db.select({ id: notifications.id, userId: notifications.userId, type: notifications.type })
            .from(notifications).where(eq(notifications.id, id)).get();
        if (!existing) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        await db.delete(notifications).where(eq(notifications.id, id));

        logger.info('Admin deleted a notification', { notificationId: id, type: existing.type, actor });
        await logAudit({
            userEmail: actor,
            action: 'notification_deleted',
            target: id,
            details: { type: existing.type, recipient: existing.userId },
        });
        return NextResponse.json({ ok: true });
    } catch (error) {
        const errorId = logger.error('Admin notification delete failed', error, { notificationId: id, actor });
        return NextResponse.json({ error: 'Internal Server Error', errorId }, { status: 500 });
    }
}
