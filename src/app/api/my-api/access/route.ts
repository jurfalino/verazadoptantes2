// /developers: ask for API access (after accepting the terms) — tool and purpose; admins are notified.
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { rescuerEmailOr401 } from '@/lib/api/sessionGuards';
import { requestAccess } from '@/lib/api/access';
import { termsAccepted } from '@/lib/api/selfService';

export const runtime = 'edge';

export async function POST(request: Request) {
    const me = await rescuerEmailOr401();
    if (me instanceof NextResponse) return me;
    try {
        const body = await request.json() as { tool?: string; purpose?: string };
        const db = await getDb();
        if (!db) throw new Error('database unavailable');
        if (!(await termsAccepted(db, me))) return NextResponse.json({ error: 'terms_required' }, { status: 403 });
        const res = await requestAccess(db, me, String(body.tool ?? ''), String(body.purpose ?? ''));
        if ('error' in res) return NextResponse.json({ error: res.error }, { status: res.error === 'tool_required' ? 422 : 409 });
        logAudit({ userEmail: me, action: 'api_access_requested', details: { tool: String(body.tool ?? '').slice(0, 120) } });
        const { runAfterResponse } = await import('@/lib/background');
        await runAfterResponse('api.accessRequest.notifyAdmins', async () => {
            const { notifyAdmins } = await import('@/app/actions/notifications');
            await notifyAdmins({ actorEmail: me, type: 'api_access_requested', title: 'Pedido de acceso a la API', body: `${me} pidió acceso a la API (${String(body.tool ?? '').slice(0, 80)}).`, url: '/admin/api?tab=people&status=requested' });
        }, { user: me });
        return NextResponse.json(res);
    } catch (e) {
        const errorId = logger.error('developers: access request failed', e, { user: me });
        return NextResponse.json({ error: 'Failed to send the request', errorId }, { status: 500 });
    }
}
