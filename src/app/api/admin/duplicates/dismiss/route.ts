export const runtime = 'edge';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { duplicateCandidates, adopterFlags } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { isAdmin } from '@/config/admins';
import { logger } from '@/lib/logger';

/**
 * POST /api/admin/duplicates/dismiss
 * Dismiss a duplicate candidate or user flag
 */
export async function POST(request: Request) {
    const session = await auth();
    if (!session?.user?.email || !isAdmin(session.user.email)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { candidateId, flagId } = await request.json() as { candidateId?: string; flagId?: string };

        const db = await getDb();
        if (!db) throw new Error('Database not available');

        if (candidateId) {
            // Dismiss system-detected candidate
            await db.update(duplicateCandidates).set({
                status: 'dismissed',
                resolvedAt: new Date(),
                resolvedBy: session.user.email,
            }).where(eq(duplicateCandidates.id, candidateId));

            logger.info('Duplicate candidate dismissed', { candidateId, user: session.user.email });
        } else if (flagId) {
            // Dismiss user-flagged duplicate
            await db.delete(adopterFlags).where(eq(adopterFlags.id, flagId));

            logger.info('Duplicate flag dismissed', { flagId, user: session.user.email });
        } else {
            return NextResponse.json({ error: 'Missing candidateId or flagId' }, { status: 400 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Dismiss duplicate failed', error);
        return NextResponse.json({ error: 'Dismiss failed' }, { status: 500 });
    }
}
