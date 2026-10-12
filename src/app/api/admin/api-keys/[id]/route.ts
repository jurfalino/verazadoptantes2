// Admin → API: revoke a key or change its daily caps.
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { apiKeys } from '@/db/schema';
import { getDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit';
import { adminEmailOr401 } from '@/lib/api/sessionGuards';
import { clampCap } from '@/lib/api/review';

export const runtime = 'edge';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const admin = await adminEmailOr401();
    if (admin instanceof NextResponse) return admin;
    const { id } = await params;
    try {
        const body = await request.json() as { revoke?: boolean; dailyCapExact?: number; dailyCapFuzzy?: number };
        const db = await getDb();
        if (!db) throw new Error('database unavailable');
        const key = await db.select().from(apiKeys).where(eq(apiKeys.id, id)).get();
        if (!key) return NextResponse.json({ error: 'Key not found' }, { status: 404 });
        const patch: Partial<typeof apiKeys.$inferInsert> = {};
        if (body.revoke && !key.revokedAt) { patch.revokedAt = new Date(); patch.revokedBy = admin; }
        if (body.dailyCapExact !== undefined) patch.dailyCapExact = clampCap(body.dailyCapExact, key.dailyCapExact);
        if (body.dailyCapFuzzy !== undefined) patch.dailyCapFuzzy = clampCap(body.dailyCapFuzzy, key.dailyCapFuzzy);
        if (Object.keys(patch).length) await db.update(apiKeys).set(patch).where(eq(apiKeys.id, id));
        logAudit({ userEmail: admin, action: body.revoke ? 'api_key_revoked' : 'api_key_updated', details: { keyId: id, ownerEmail: key.ownerEmail, ...patch } });
        return NextResponse.json({ ok: true });
    } catch (e) {
        const errorId = logger.error('admin api-keys: update failed', e, { admin, keyId: id });
        return NextResponse.json({ error: 'Failed to update key', errorId }, { status: 500 });
    }
}
