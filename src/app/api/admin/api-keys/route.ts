// Admin → API: list keys, issue a key (the secret is shown once).
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { adminEmailOr401 } from '@/lib/api/sessionGuards';
import { issueKey, listKeys } from '@/lib/api/review';

export const runtime = 'edge';

export async function GET() {
    const admin = await adminEmailOr401();
    if (admin instanceof NextResponse) return admin;
    try {
        const db = await getDb();
        if (!db) throw new Error('database unavailable');
        // A key its owner created is theirs to regenerate (the admin must not see its secret) — except the admin's own.
        const keys = (await listKeys(db, null)).map(k => ({ ...k, canRegenerate: !k.revokedAt && (!k.selfService || k.ownerEmail === admin) }));
        return NextResponse.json({ keys });
    } catch (e) {
        const errorId = logger.error('admin api-keys: list failed', e, { admin });
        return NextResponse.json({ error: 'Failed to load keys', errorId }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const admin = await adminEmailOr401();
    if (admin instanceof NextResponse) return admin;
    let ownerEmail = '';
    try {
        const body = await request.json() as { ownerEmail?: string; name?: string; scopes?: string[]; dailyCapExact?: number; dailyCapFuzzy?: number };
        ownerEmail = (body.ownerEmail || '').trim().toLowerCase();
        const name = (body.name || '').trim();
        if (!ownerEmail || !name) return NextResponse.json({ error: 'ownerEmail and name are required' }, { status: 400 });
        const db = await getDb();
        if (!db) throw new Error('database unavailable');
        const issued = await issueKey(db, { ...body, ownerEmail, name }, new URL(request.url).hostname, admin);
        if ('error' in issued) {
            return issued.error === 'blocked'
                ? NextResponse.json({ error: 'This person is blocked from the API', code: issued.error }, { status: 409 })
                : NextResponse.json({ error: 'No user with that email', code: issued.error }, { status: 404 });
        }
        logAudit({ userEmail: admin, action: 'api_key_issued', details: { keyId: issued.id, ownerEmail, name, environment: issued.environment } });
        logger.info('admin api-keys: key issued', { admin, keyId: issued.id, ownerEmail });
        return NextResponse.json(issued, { status: 201 });
    } catch (e) {
        const errorId = logger.error('admin api-keys: issue failed', e, { admin, ownerEmail });
        return NextResponse.json({ error: 'Failed to issue key', errorId }, { status: 500 });
    }
}
