// Admin → API → one person: their access, keys, daily use and the names they searched (GET);
// approve / deny / block / unblock their API access (POST).
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { adminEmailOr401 } from '@/lib/api/sessionGuards';
import { personDetail } from '@/lib/api/adminInsights';
import { parseCursor } from '@/lib/api/review';
import { decideAccess, type Decision } from '@/lib/api/access';
import { maskEmail } from '@/lib/dates';

export const runtime = 'edge';

const DECISIONS: Decision[] = ['approve', 'deny', 'block', 'unblock'];

export async function GET(request: Request, { params }: { params: Promise<{ email: string }> }) {
    const admin = await adminEmailOr401();
    if (admin instanceof NextResponse) return admin;
    const email = decodeURIComponent((await params).email).trim().toLowerCase();
    const before = new URL(request.url).searchParams.get('before');
    try {
        const db = await getDb();
        if (!db) throw new Error('database unavailable');
        const detail = await personDetail(db, email, { before: parseCursor(before) });
        // The searched names are person data: the admin reading them is audited.
        logAudit({ userEmail: admin, action: 'api_person_viewed', details: { ownerEmail: email } });
        return NextResponse.json(detail);
    } catch (e) {
        const errorId = logger.error('admin api: person failed', e, { admin, person: maskEmail(email) });
        return NextResponse.json({ error: 'Failed to load the person', errorId }, { status: 500 });
    }
}

export async function POST(request: Request, { params }: { params: Promise<{ email: string }> }) {
    const admin = await adminEmailOr401();
    if (admin instanceof NextResponse) return admin;
    const email = decodeURIComponent((await params).email).trim().toLowerCase();
    let decision = '';
    try {
        const body = await request.json() as { decision?: string; note?: string };
        decision = String(body.decision ?? '');
        if (!DECISIONS.includes(decision as Decision)) return NextResponse.json({ error: 'decision must be approve, deny, block or unblock' }, { status: 422 });
        const db = await getDb();
        if (!db) throw new Error('database unavailable');
        const done = await decideAccess(db, email, decision as Decision, admin, body.note ?? null);
        logAudit({ userEmail: admin, action: `api_access_${decision}`, details: { ownerEmail: email, keysRevoked: done.keysRevoked, note: body.note ?? null } });
        // Tell the person (approve / deny / block), like any decision about them.
        if (decision !== 'unblock') {
            const { runAfterResponse } = await import('@/lib/background');
            await runAfterResponse('api.accessDecision.notify', async () => {
                const { createNotification } = await import('@/app/actions/notifications');
                const { PENDING_APPROVAL_CAPS } = await import('@/lib/api/access');
                const { SELF_SERVICE_CAPS } = await import('@/lib/api/selfService');
                const title = decision === 'approve' ? 'Tu acceso a la API fue aprobado' : decision === 'deny' ? 'Tu pedido de acceso a la API no fue aprobado' : 'Tu acceso a la API fue bloqueado';
                const note = body.note?.trim();
                const bodyText = decision === 'approve'
                    ? `Tus claves pasan a ${SELF_SERVICE_CAPS.exact} búsquedas exactas y ${SELF_SERVICE_CAPS.fuzzy} fuzzy por día.`
                    : decision === 'deny'
                        ? `Tus claves siguen con ${PENDING_APPROVAL_CAPS.exact} búsquedas exactas y ${PENDING_APPROVAL_CAPS.fuzzy} fuzzy por día.${note ? ` ${note}` : ''}`
                        : (note || 'Si tenés dudas, escribinos.');
                await createNotification({ userId: email, type: 'api_access', title, body: bodyText, url: '/developers' });
            }, { person: maskEmail(email), decision });
        }
        return NextResponse.json({ ok: true, ...done });
    } catch (e) {
        const errorId = logger.error('admin api: access decision failed', e, { admin, person: maskEmail(email), decision });
        return NextResponse.json({ error: 'Failed to save the decision', errorId }, { status: 500 });
    }
}
