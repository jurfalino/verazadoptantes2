// Admin → API: a new secret for a key (the old one stops working at once).
// The secret is returned once, like on issue; only its hash is stored.
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { adminEmailOr401 } from '@/lib/api/sessionGuards';
import { eq } from 'drizzle-orm';
import { apiKeys } from '@/db/schema';
import { regenerateKey } from '@/lib/api/review';

export const runtime = 'edge';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const admin = await adminEmailOr401();
    if (admin instanceof NextResponse) return admin;
    const { id } = await params;
    try {
        const db = await getDb();
        if (!db) throw new Error('database unavailable');
        // A key the person created themselves is theirs to regenerate (at /developers):
        // an admin must never see its secret (review 2026-10-17).
        const key = await db.select({ ownerEmail: apiKeys.ownerEmail, createdBy: apiKeys.createdBy }).from(apiKeys).where(eq(apiKeys.id, id)).get();
        if (key && key.createdBy === key.ownerEmail && key.ownerEmail !== admin) {
            return NextResponse.json({ error: 'This key was created by its owner: they regenerate it at /developers (you can revoke it)', code: 'self_service' }, { status: 409 });
        }
        const done = await regenerateKey(db, id, new URL(request.url).hostname);
        if ('error' in done) {
            return NextResponse.json({ error: done.error === 'revoked' ? 'A revoked key cannot be regenerated' : 'Key not found', code: done.error }, { status: done.error === 'revoked' ? 409 : 404 });
        }
        logAudit({ userEmail: admin, action: 'api_key_regenerated', details: { keyId: id, ownerEmail: done.ownerEmail, name: done.name, environment: done.environment } });
        logger.info('admin api-keys: key regenerated', { admin, keyId: id, ownerEmail: done.ownerEmail });
        return NextResponse.json({ id: done.id, secret: done.secret, prefix: done.prefix, environment: done.environment });
    } catch (e) {
        const errorId = logger.error('admin api-keys: regenerate failed', e, { admin, keyId: id });
        return NextResponse.json({ error: 'Failed to regenerate key', errorId }, { status: 500 });
    }
}
