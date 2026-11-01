export const runtime = 'edge';

import { getDb } from '@/app/actions/_db';
import { adopters, dataRequests } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { logger } from '@/lib/logger';
import { runAfterResponse } from '@/lib/background';

const REQUEST_TYPES = ['inaccuracy', 'deletion'] as const;
type RequestType = typeof REQUEST_TYPES[number];

export async function POST(req: NextRequest) {
    // Outside the try so the catch can log them.
    let requester = '';
    let adopterId: string | null = null;
    let requestType: string | undefined;
    try {
        const session = await auth();
        requester = session?.user?.email?.trim().toLowerCase() ?? '';
        if (!requester) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Who is asking comes from the session, never the body (Jon 2026-10-31:
        // «why ask for name & email if we already know it»).
        const body = await req.json() as { adopterId?: string; requestType?: string; details?: string };
        adopterId = body.adopterId || null;
        requestType = body.requestType;
        const details = body.details?.trim() || null;

        if (!requestType || !(REQUEST_TYPES as readonly string[]).includes(requestType)) {
            return NextResponse.json({ error: 'Request type is required' }, { status: 400 });
        }

        const db = await getDb();
        if (!db) {
            return NextResponse.json({ error: 'Database unavailable' }, { status: 500 });
        }

        // A report about a profile must name a live one (a made-up id would still reach every admin).
        if (adopterId) {
            const live = await db.select({ id: adopters.id, deletedAt: adopters.deletedAt })
                .from(adopters).where(eq(adopters.id, adopterId)).get() as { id: string; deletedAt: Date | null } | undefined;
            if (!live || live.deletedAt) {
                return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
            }
        }

        // One open report per person per profile tells people once: a repeat is
        // kept (it may add detail) but sends nothing — as requestAdopterDeletion does.
        const alreadyOpen = adopterId ? !!(await db.select({ id: dataRequests.id }).from(dataRequests).where(and(
            eq(dataRequests.adopterId, adopterId),
            eq(dataRequests.requesterEmail, requester),
            eq(dataRequests.requestType, requestType),
            eq(dataRequests.status, 'pending'),
        )).get()) : false;

        const { resolveDisplayName } = await import('@/app/actions/notifications');
        const requesterName = await resolveDisplayName(requester);

        const id = crypto.randomUUID();
        await db.insert(dataRequests).values({
            id,
            adopterId,
            requesterName,
            requesterEmail: requester,
            requestType,
            details,
        });
        logger.info('Data request filed', { adopterId, requester, requestType, repeat: alreadyOpen });

        // «La información es incorrecta» tells everyone who can fix the profile,
        // then the admins (after the response, kept alive — see src/lib/background.ts).
        if ((requestType as RequestType) === 'inaccuracy' && adopterId && !alreadyOpen) {
            const profileId = adopterId;
            await runAfterResponse('dataRequest.notifyInaccuracy', async () => {
                let told: string[] = [];
                let adopterName: string | null = null;
                try {
                    const { notifyInaccuracyReportEditors } = await import('@/lib/inaccuracyReportNotices');
                    ({ told, adopterName } = await notifyInaccuracyReportEditors({ adopterId: profileId, reporter: requester, details }));
                } catch (e) {
                    logger.warn('dataRequest: inaccuracy notices to editors not sent', {
                        adopterId: profileId, actor: requester, error: e instanceof Error ? e.message : String(e),
                    });
                }
                const [{ notifyAdmins }, { notificationContent }, { noticeDetails }] = await Promise.all([
                    import('@/app/actions/notifications'), import('@/domain/notificationTemplates'), import('@/lib/inaccuracyReportNotices'),
                ]);
                const quoted = noticeDetails(details);
                await notifyAdmins({
                    skip: told,
                    actorEmail: requester,
                    type: 'inaccuracy_reported',
                    ...notificationContent({ key: 'inaccuracy_reported', params: { reporterName: requesterName, ...(adopterName ? { adopterName } : {}), ...(quoted ? { details: quoted } : {}) } }),
                    url: '/admin/data-requests',
                    icon: '✏️',
                    metadata: { adopterId: profileId },
                });
            }, { adopterId: profileId, actor: requester });
        }

        return NextResponse.json({ success: true, id });
    } catch (error) {
        const errorId = logger.error('Data request failed', error, { adopterId, requester, requestType });
        return NextResponse.json({ error: 'Failed to submit request', errorId }, { status: 500 });
    }
}
