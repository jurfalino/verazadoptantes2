// /developers: the signed-in user's own keys — list, and create one (after accepting the API terms).
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { rescuerEmailOr401 } from '@/lib/api/sessionGuards';
import { createMyKey, myDeveloperState } from '@/lib/api/selfService';
import { announceAccessRequest } from '@/lib/api/accessNotify';

export const runtime = 'edge';

export async function GET(request: Request) {
    const me = await rescuerEmailOr401();
    if (me instanceof NextResponse) return me;
    try {
        const db = await getDb();
        if (!db) throw new Error('database unavailable');
        return NextResponse.json(await myDeveloperState(db, me, new URL(request.url).host));
    } catch (e) {
        const errorId = logger.error('developers: load failed', e, { user: me });
        return NextResponse.json({ error: 'Failed to load your keys', errorId }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const me = await rescuerEmailOr401();
    if (me instanceof NextResponse) return me;
    let name = '';
    try {
        const body = (await request.json()) as { name?: unknown; purpose?: unknown };
        name = String(body.name ?? '').trim().slice(0, 80);
        const db = await getDb();
        if (!db) throw new Error('database unavailable');
        const res = await createMyKey(db, me, name, new URL(request.url).host, String(body.purpose ?? ''));
        if ('error' in res) {
            const status = res.error === 'terms_required' || res.error === 'blocked' ? 403 : res.error === 'too_many_keys' || res.error === 'too_many_today' ? 409 : 422;
            return NextResponse.json({ error: res.error }, { status });
        }
        logAudit({ userEmail: me, action: 'api_key_self_created', details: { keyId: res.id, name, environment: res.environment } });
        // Their first key filed the access request: the admins hear about it.
        if ('requested' in res && res.requested) await announceAccessRequest(me, name);
        logger.info('developers: key created', { user: me, keyId: res.id, environment: res.environment });
        return NextResponse.json(res, { status: 201 });
    } catch (e) {
        const errorId = logger.error('developers: key create failed', e, { user: me, name });
        return NextResponse.json({ error: 'Failed to create the key', errorId }, { status: 500 });
    }
}
