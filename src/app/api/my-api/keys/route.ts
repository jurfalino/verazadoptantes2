// /developers: the signed-in user's own keys — list, and create one (after accepting the API terms).
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { rescuerEmailOr401 } from '@/lib/api/sessionGuards';
import { createMyKey, myDeveloperState } from '@/lib/api/selfService';

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
        name = String(((await request.json()) as { name?: unknown }).name ?? '').trim().slice(0, 80);
        const db = await getDb();
        if (!db) throw new Error('database unavailable');
        const res = await createMyKey(db, me, name, new URL(request.url).host);
        if ('error' in res) {
            const status = res.error === 'terms_required' || res.error === 'not_approved' ? 403 : res.error === 'too_many_keys' || res.error === 'too_many_today' ? 409 : 422;
            return NextResponse.json({ error: res.error }, { status });
        }
        logAudit({ userEmail: me, action: 'api_key_self_created', details: { keyId: res.id, name, environment: res.environment } });
        logger.info('developers: key created', { user: me, keyId: res.id, environment: res.environment });
        return NextResponse.json(res, { status: 201 });
    } catch (e) {
        const errorId = logger.error('developers: key create failed', e, { user: me, name });
        return NextResponse.json({ error: 'Failed to create the key', errorId }, { status: 500 });
    }
}
