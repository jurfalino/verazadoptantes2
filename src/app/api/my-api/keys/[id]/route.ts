// /developers: regenerate or revoke one of the signed-in user's OWN keys.
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { rescuerEmailOr401 } from '@/lib/api/sessionGuards';
import { regenerateMyKey, revokeMyKey } from '@/lib/api/selfService';

export const runtime = 'edge';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const me = await rescuerEmailOr401();
    if (me instanceof NextResponse) return me;
    const { id } = await params;
    let action = '';
    try {
        action = String(((await request.json()) as { action?: unknown }).action ?? '');
        const db = await getDb();
        if (!db) throw new Error('database unavailable');
        if (action === 'revoke') {
            const res = await revokeMyKey(db, me, id);
            if ('error' in res) return NextResponse.json({ error: res.error }, { status: 404 });
            logAudit({ userEmail: me, action: 'api_key_self_revoked', details: { keyId: id } });
            return NextResponse.json(res);
        }
        if (action === 'regenerate') {
            const res = await regenerateMyKey(db, me, id, new URL(request.url).host);
            if ('error' in res) return NextResponse.json({ error: res.error }, { status: res.error === 'not_found' ? 404 : 409 });
            logAudit({ userEmail: me, action: 'api_key_self_regenerated', details: { keyId: id } });
            return NextResponse.json({ id: res.id, secret: res.secret, prefix: res.prefix, environment: res.environment });
        }
        return NextResponse.json({ error: 'unknown action' }, { status: 422 });
    } catch (e) {
        const errorId = logger.error('developers: key action failed', e, { user: me, keyId: id, action });
        return NextResponse.json({ error: 'Failed', errorId }, { status: 500 });
    }
}
