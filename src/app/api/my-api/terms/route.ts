// /developers: the signed-in user accepts the current API terms (needed before their first key).
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { rescuerEmailOr401 } from '@/lib/api/sessionGuards';
import { acceptTerms, API_TERMS_VERSION } from '@/lib/api/selfService';

export const runtime = 'edge';

export async function POST() {
    const me = await rescuerEmailOr401();
    if (me instanceof NextResponse) return me;
    try {
        const db = await getDb();
        if (!db) throw new Error('database unavailable');
        await acceptTerms(db, me);
        logAudit({ userEmail: me, action: 'api_terms_accepted', details: { version: API_TERMS_VERSION } });
        return NextResponse.json({ ok: true, version: API_TERMS_VERSION });
    } catch (e) {
        const errorId = logger.error('developers: terms accept failed', e, { user: me });
        return NextResponse.json({ error: 'Failed to save', errorId }, { status: 500 });
    }
}
